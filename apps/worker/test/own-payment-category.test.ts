import { describe, expect, it } from "vitest";
import { tool } from "./account-helpers";
import { account, bulk, DAY, type Json, logs, MONTH, plan, send, tx } from "./bulk-helpers";
import { json } from "./helpers";
import { S } from "./scheduled-helpers";

// EXF-539 (D5): a row on a card may not use that card's own payment category.
const own = (card: string) =>
  `A transaction on ${card} can't use its own payment category. Choose a spending category, or use Record Payment to pay ${card} from a cash account.`;

async function cardSetup() {
  const b = await plan();
  const checking = await account(b, "checking", 500000);
  const visa = await account(b, "creditCard", 0);
  const visa2 = await account(b, "creditCard", 0);
  const m = (await (await json(`/api/v1/budgets/${b}/months/${MONTH}`)).json()) as Json;
  const cats = m.data.groups.flatMap((g: Json) => g.categories) as Json[];
  const pay = (id: string) => cats.find((c) => c.account_id === id).id as string;
  const name = async (id: string) =>
    ((await (await json(`/api/v1/budgets/${b}/accounts/${id}`)).json()) as Json).data.account
      .name as string;
  return { b, checking, visa, visa2, payOf: pay, name };
}

async function refusedRest(res: Response, text: string) {
  const body = (await res.json()) as Json;
  expect(res.status, JSON.stringify(body)).toBe(422);
  expect(body.error.name).toBe("own_payment_category");
  expect(body.error.detail).toContain(text);
  return body.error.detail as string;
}

describe("own payment category", () => {
  it("create, patch and split are refused with the text and write nothing", async () => {
    const { b, visa, payOf, name } = await cardSetup();
    const text = own(await name(visa));
    const before = await logs(b);
    await refusedRest(
      await send(`/api/v1/budgets/${b}/transactions`, "POST", {
        account_id: visa,
        date: DAY,
        amount: -5000,
        category_id: payOf(visa),
      }),
      text,
    );
    const ok = await tx(b, { account_id: visa, date: DAY, amount: -5000 });
    const afterOk = await logs(b);
    expect(afterOk).toBe(before + 1);
    await refusedRest(
      await send(`/api/v1/budgets/${b}/transactions/${ok.id}`, "PATCH", {
        category_id: payOf(visa),
      }),
      text,
    );
    await refusedRest(
      await send(`/api/v1/budgets/${b}/transactions`, "POST", {
        account_id: visa,
        date: DAY,
        amount: -6000,
        subtransactions: [{ amount: -3000, category_id: payOf(visa) }, { amount: -3000 }],
      }),
      text,
    );
    expect(await logs(b)).toBe(afterOk);
  });

  it("bulk categorize and bulk move are refused with the id prefix", async () => {
    const { b, checking, visa, payOf, name } = await cardSetup();
    const text = own(await name(visa));
    const r = await tx(b, { account_id: visa, date: DAY, amount: -5000 });
    const before = await logs(b);
    const res = await bulk(b, { op: "categorize", ids: [r.id], value: payOf(visa) });
    const detail = await refusedRest(res, text);
    expect(detail.startsWith(`Transaction ${r.id}: `)).toBe(true);
    const c = await tx(b, {
      account_id: checking,
      date: DAY,
      amount: -7000,
      category_id: payOf(visa),
    });
    const beforeMove = await logs(b);
    const mv = await bulk(b, { op: "move", ids: [c.id], value: visa });
    await refusedRest(mv, text);
    expect(await logs(b)).toBe(beforeMove);
  });

  it("a scheduled create on the card is refused", async () => {
    const { b, visa, payOf, name } = await cardSetup();
    const res = await send(`${S(b)}?today=2026-11-15`, "POST", {
      account_id: visa,
      date_first: "2026-11-20",
      frequency: "never",
      amount: -8000,
      payee_name: "ZZ-TEST Shop",
      category_id: payOf(visa),
    });
    await refusedRest(res, own(await name(visa)));
  });

  it("MCP create_transaction returns the same text as a tool error", async () => {
    const { b, visa, payOf, name } = await cardSetup();
    const t = await tool("create_transaction", {
      budget_id: b,
      account_id: visa,
      date: DAY,
      amount: -5000,
      category_id: payOf(visa),
    });
    expect(t.isError).toBe(true);
    expect(t.content[0].text).toContain(own(await name(visa)));
  });

  it("a cash row, and a card row in another card's category, are allowed", async () => {
    const { b, checking, visa, visa2, payOf } = await cardSetup();
    await tx(b, { account_id: checking, date: DAY, amount: -5000, category_id: payOf(visa) });
    await tx(b, { account_id: visa, date: DAY, amount: -5000, category_id: payOf(visa2) });
  });
});
