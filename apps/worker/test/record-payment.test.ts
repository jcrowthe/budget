import { paymentCategoryOf } from "@budget/schema/card-payments";
import { describe, expect, it } from "vitest";
import { tool } from "./account-helpers";
import { account, category, DAY, type Json, plan, q, send, tx } from "./bulk-helpers";
import { json } from "./helpers";
import { apiPaths, listedToolNames } from "./surface";

// EXF-539: the payments operation and the ticket's worked figures, to the milliunit.
const MONTH = "2026-11-01";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const api = (b: string, p: string) => `/api/v1/budgets/${b}${p}`;
const body = async (res: Response) => (await res.json()) as Json;

async function seed(month = MONTH, date = DAY) {
  const b = await plan();
  const checking = await account(b, "checking", 1000000);
  const visa = await account(b, "creditCard", 0);
  const groceries = await category(b);
  const set = await send(api(b, `/months/${month}/categories/${groceries}`), "PATCH", {
    assigned: 335000,
  });
  expect(set.status).toBe(200);
  await tx(b, { account_id: visa, date, amount: -335000, category_id: groceries });
  return { b, checking, visa, groceries };
}
const available = async (b: string, visa: string, month = MONTH) => {
  const m = (await body(await json(api(b, `/months/${month}`)))).data;
  return paymentCategoryOf(m, visa);
};
const balance = async (b: string, id: string) =>
  (await body(await json(api(b, `/accounts/${id}`)))).data.account.balance as number;
const pay = (b: string, visa: string, input: Json) =>
  send(api(b, `/accounts/${visa}/payments`), "POST", input);
const logsOf = (ids: string[]) =>
  q(
    `select actor, action, entity_type from change_log where entity_id in (${ids.map(() => "?").join(",")})`,
    ...ids,
  );

describe("the ticket's figures", () => {
  it("335.00 available and -335.00 owed; pay 200.00, then 185.00", async () => {
    const { b, checking, visa } = await seed();
    expect((await available(b, visa))?.available).toBe(335000);
    expect(await balance(b, visa)).toBe(-335000);

    const r1 = await pay(b, visa, { from_account_id: checking, amount: 200000, date: DAY });
    expect(r1.status).toBe(201);
    const d1 = (await body(r1)).data;
    expect(d1.amount).toBe(200000);
    expect(d1.from_transaction).toMatchObject({
      account_id: checking,
      amount: -200000,
      category_id: null,
      transfer_account_id: visa,
      transfer_transaction_id: d1.to_transaction.id,
    });
    expect(d1.to_transaction).toMatchObject({
      account_id: visa,
      amount: 200000,
      category_id: null,
      transfer_account_id: checking,
      transfer_transaction_id: d1.from_transaction.id,
    });
    const logs = await logsOf([d1.from_transaction.id, d1.to_transaction.id]);
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.action === "create" && l.actor.startsWith("user:"))).toBe(true);
    expect((await available(b, visa))?.available).toBe(135000);
    expect(await balance(b, visa)).toBe(-135000);

    const r2 = await pay(b, visa, { from_account_id: checking, amount: 185000, date: DAY });
    expect(r2.status).toBe(201);
    const after = (await available(b, visa))?.available;
    expect(after).toBe(-50000);
    const m = (await body(await json(api(b, `/months/${MONTH}`)))).data;
    const cat = m.groups
      .flatMap((g: Json) => g.categories)
      .find((c: Json) => c.account_id === visa);
    expect(cat.state).toBe("cash_overspent");
    expect(await balance(b, visa)).toBe(50000);
  });
});

describe("defaults", () => {
  it("pays the Available dated today (UTC), then refuses with nothing_to_pay", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const month = `${today.slice(0, 7)}-01`;
    const { b, checking, visa } = await seed(month, today);
    const res = await pay(b, visa, { from_account_id: checking });
    expect(res.status).toBe(201);
    const d = (await body(res)).data;
    expect(d.amount).toBe(335000);
    expect(d.from_transaction.date).toBe(today);
    expect((await available(b, visa, month))?.available).toBe(0);
    const n = (await q("select count(*) n from transactions where budget_id = ?", b))[0]?.n;
    const again = await pay(b, visa, { from_account_id: checking });
    expect(again.status).toBe(422);
    expect((await body(again)).error.name).toBe("nothing_to_pay");
    expect((await q("select count(*) n from transactions where budget_id = ?", b))[0]?.n).toBe(n);
  });

  it("MCP pay_credit_card writes the same pair with the mcp actor", async () => {
    const { b, checking, visa } = await seed();
    const t = await tool("pay_credit_card", {
      budget_id: b,
      card_account_id: visa,
      from_account_id: checking,
      amount: 1000,
      date: DAY,
    });
    expect(t.isError).toBeFalsy();
    const d = JSON.parse(t.content[0].text);
    expect(d.from_transaction).toMatchObject({ amount: -1000, transfer_account_id: visa });
    expect(d.to_transaction).toMatchObject({ amount: 1000, transfer_account_id: checking });
    expect(d.from_transaction.created_at).toMatch(ISO);
    const logs = await logsOf([d.from_transaction.id, d.to_transaction.id]);
    expect(logs.every((l) => l.actor.startsWith("mcp:"))).toBe(true);
  });
});

describe("refusals write nothing", () => {
  it("each source and card refusal is a 422 with a code, and MCP gives a tool error", async () => {
    const { b, checking, visa } = await seed();
    const visa2 = await account(b, "creditCard", 0);
    const asset = await account(b, "otherAsset", 0);
    const closed = await account(b, "checking", 0);
    expect((await send(api(b, `/accounts/${closed}/close`), "POST", {})).status).toBe(200);
    const count = async () =>
      (await q("select count(*) n from transactions where budget_id = ?", b))[0]?.n;
    const n = await count();
    const cases: [string, Json, number, string | null][] = [
      [visa, { from_account_id: visa2, amount: 1000 }, 422, "invalid_payment_source"],
      [visa, { from_account_id: asset, amount: 1000 }, 422, "invalid_payment_source"],
      [visa, { from_account_id: visa, amount: 1000 }, 422, "invalid_payment_source"],
      [checking, { from_account_id: visa, amount: 1000 }, 422, "not_a_credit_account"],
      [visa, { from_account_id: closed, amount: 1000 }, 422, "account_closed"],
      ["no-such-card", { from_account_id: checking, amount: 1000 }, 404, null],
      [visa, { from_account_id: checking, amount: 0 }, 422, null],
    ];
    for (const [card, input, status, code] of cases) {
      const res = await pay(b, card, input);
      expect(res.status, JSON.stringify(input)).toBe(status);
      if (code) expect((await body(res)).error.name).toBe(code);
      expect(await count()).toBe(n);
    }
    const t = await tool("pay_credit_card", {
      budget_id: b,
      card_account_id: visa,
      from_account_id: asset,
      amount: 1000,
    });
    expect(t.isError).toBe(true);
    expect(t.content[0].text).toContain("Pay a card from an on-plan cash account");
  });
});

describe("the surface", () => {
  it("lists the route and the tool", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/budgets/{budget_id}/accounts/{account_id}/payments"]),
    );
    expect(await listedToolNames()).toContain("pay_credit_card");
  });
});
