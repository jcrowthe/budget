import { describe, expect, it } from "vitest";
import { category } from "./bulk-helpers";
import { account, body, type Json, plan, q, S, sched, send } from "./scheduled-helpers";
import { setOf, undo } from "./undo-helpers";

const P = (b: string) => `/api/v1/budgets/${b}/payees`;

async function seed(parentPayee?: string) {
  const b = await plan();
  const a = await account(b);
  const c1 = await category(b, "Groceries");
  const c2 = await category(b, "Transportation");
  const s = (
    await sched(b, {
      account_id: a,
      date_first: "2026-12-01",
      frequency: "monthly",
      amount: -40000,
      ...(parentPayee ? { payee_name: parentPayee } : {}),
      subtransactions: [
        { amount: -30000, category_id: c1, payee_name: "ZZ-TEST Line Payee" },
        { amount: -10000, category_id: c2 },
      ],
    })
  ).scheduled_transaction;
  const list = (await body(await send(`${P(b)}`, "GET"))).payees as Json[];
  const pid = (n: string) => list.find((x) => x.name === n)?.id as string;
  return { b, a, id: s.id as string, line: pid("ZZ-TEST Line Payee"), pid, list };
}
/** A second payee, made by a plain schedule that names it. */
async function keeper(b: string, a: string) {
  await sched(b, {
    account_id: a,
    date_first: "2026-12-05",
    frequency: "monthly",
    amount: -1,
    payee_name: "ZZ-TEST Keeper",
  });
  const list = (await body(await send(P(b), "GET"))).payees as Json[];
  return list.find((x) => x.name === "ZZ-TEST Keeper")?.id as string;
}
const linePayee = async (id: string) =>
  (
    await q(
      "select payee_id from scheduled_subtransactions where scheduled_transaction_id = ? and deleted_at is null order by sort",
      id,
    )
  ).map((r) => r.payee_id);

describe("payees and split schedule lines", () => {
  it("the payee list counts a schedule once, also when parent and line share the payee", async () => {
    const s = await seed("ZZ-TEST Line Payee");
    const p = s.list.find((x) => x.id === s.line);
    expect(p.scheduled_count).toBe(1);
  });

  it("delete with a replacement moves the line, and undo moves it back", async () => {
    const s = await seed();
    const other = await keeper(s.b, s.a);
    const res = await send(`${P(s.b)}/${s.line}?replacement_payee_id=${other}`, "DELETE");
    expect(res.status).toBe(200);
    expect((await linePayee(s.id))[0]).toBe(other);
    const r = await undo(s.b, setOf(res));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await linePayee(s.id))[0]).toBe(s.line);
  });

  it("delete with no replacement clears the line's payee, and undo restores it", async () => {
    const s = await seed();
    const res = await send(`${P(s.b)}/${s.line}`, "DELETE");
    expect(res.status).toBe(200);
    expect((await linePayee(s.id))[0]).toBeNull();
    const r = await undo(s.b, setOf(res));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await linePayee(s.id))[0]).toBe(s.line);
  });

  it("combine moves the line to the survivor", async () => {
    const s = await seed();
    const other = await keeper(s.b, s.a);
    const res = await send(`${P(s.b)}/combine`, "POST", {
      payee_ids: [s.line, other],
      target_payee_id: other,
      name: "ZZ-TEST Keeper",
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await linePayee(s.id))[0]).toBe(other);
  });

  it("the payee's transactions pane lists the schedule", async () => {
    const s = await seed();
    const res = await send(`${P(s.b)}/${s.line}/transactions`, "GET");
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain(s.id);
  });
});
