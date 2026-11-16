import { describe, expect, it } from "vitest";
import {
  account,
  bulkOk,
  category,
  DAY,
  get,
  type Json,
  logs,
  plan,
  q,
  setSql,
  tool,
  tx,
} from "./bulk-helpers";
import { json } from "./helpers";
import { apiPaths, listedToolNames } from "./surface";

const BID = (b: string) => `/api/v1/budgets/${b}`;
const changeLogOf = (id: string) =>
  q("select actor, action from change_log where entity_id = ? order by rowid", id);

describe("surface", () => {
  it("lists the bulk and export paths and the three tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/transactions/bulk",
        "/api/v1/budgets/{budget_id}/transactions/export",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "bulk_update_transactions",
        "delete_transactions",
        "flag_transactions",
      ]),
    );
  });
});

describe("clear and unclear", () => {
  it("clears the selected rows, writes one change_log row each, and skips a reconciled row", async () => {
    const b = await plan();
    const a = await account(b);
    const r1 = await tx(b, { account_id: a, date: DAY, amount: -100000, memo: "one" });
    const r2 = await tx(b, { account_id: a, date: DAY, amount: -60000 });
    const r3 = await tx(b, { account_id: a, date: DAY, amount: -5000 });
    await setSql(r3.id, "cleared = 'reconciled'");
    const before = await logs(b);
    const res = await bulkOk(b, { op: "clear", ids: [r1.id, r2.id, r3.id] });
    expect(res.changed).toEqual([r1.id, r2.id]);
    expect(res.skipped).toEqual([{ id: r3.id, reason: "reconciled" }]);
    expect(res.transactions.map((t: Json) => t.cleared)).toEqual(["cleared", "cleared"]);
    expect(await logs(b)).toBe(before + 2);
    expect(await changeLogOf(r1.id)).toContainEqual({
      actor: "user:tester@localhost",
      action: "update",
    });
    expect((await get(b, r3.id)).cleared).toBe("reconciled");
    const again = await bulkOk(b, { op: "clear", ids: [r1.id] });
    expect(again.skipped).toEqual([{ id: r1.id, reason: "unchanged" }]);
    const back = await bulkOk(b, { op: "unclear", ids: [r1.id, r2.id] });
    expect(back.changed).toEqual([r1.id, r2.id]);
  });

  it("changes only the selected side of a transfer", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    await bulkOk(b, { op: "clear", ids: [t.id] });
    expect((await get(b, t.id)).cleared).toBe("cleared");
    expect((await get(b, t.transfer_transaction_id)).cleared).toBe("uncleared");
  });
});

describe("memo, categorize, flag", () => {
  it("sets memos; a transfer's other side follows; null clears", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100 });
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    const res = await bulkOk(b, { op: "memo", ids: [r.id, t.id], value: "x" });
    expect(res.changed).toEqual([r.id, t.id]);
    expect(res.others).toEqual([t.transfer_transaction_id]);
    expect((await get(b, t.transfer_transaction_id)).memo).toBe("x");
    const cleared = await bulkOk(b, { op: "memo", ids: [r.id], value: null });
    expect(cleared.transactions[0].memo).toBeNull();
  });

  it("categorizes, approves, and reports what takes no category", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const cat = await category(b);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100, approved: false });
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    const res = await bulkOk(b, { op: "categorize", ids: [r.id, t.id], value: cat });
    expect(res.changed).toEqual([r.id]);
    expect(res.skipped).toEqual([{ id: t.id, reason: "category_not_needed" }]);
    const row = await get(b, r.id);
    expect(row).toMatchObject({ category_id: cat, approved: true });
    const rta = await bulkOk(b, { op: "categorize", ids: [r.id], value: "ready_to_assign" });
    expect(rta.transactions[0]).toMatchObject({
      category_id: null,
      inflow_to_ready_to_assign: true,
    });
  });

  it("flags rows, not their sides together, and reads the colour back", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    const res = await bulkOk(b, { op: "flag", ids: [t.id], value: "blue" });
    expect(res.transactions[0].flag_color).toBe("blue");
    expect((await get(b, t.transfer_transaction_id)).flag_color).toBeNull();
    const none = await bulkOk(b, { op: "flag", ids: [t.id], value: null });
    expect(none.transactions[0].flag_color).toBeNull();
  });
});

describe("move", () => {
  it("moves rows and keeps cleared; both balances follow", async () => {
    const b = await plan();
    const a1 = await account(b, "checking", 0);
    const a2 = await account(b, "checking", 0);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100000, cleared: "cleared" });
    const res = await bulkOk(b, { op: "move", ids: [r.id], value: a2 });
    expect(res.transactions[0]).toMatchObject({ account_id: a2, cleared: "cleared" });
    const list = async (a: string) =>
      ((await (await json(`${BID(b)}/accounts/${a}/transactions`)).json()) as Json).data;
    expect((await list(a1)).balances.working).toBe(0);
    expect((await list(a2)).balances.working).toBe(-100000);
  });

  it("keeps an import's fields", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100, approved: false });
    await setSql(r.id, "import_id = 'zz-m', source = 'plaid'");
    await bulkOk(b, { op: "move", ids: [r.id], value: a2 });
    expect(await get(b, r.id)).toMatchObject({
      import_id: "zz-m",
      source: "plaid",
      account_id: a2,
    });
  });
});

describe("delete", () => {
  it("deletes both sides of a transfer once and a split with its lines", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const cat = await category(b);
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    const s = await tx(b, {
      account_id: a1,
      date: DAY,
      amount: -300,
      subtransactions: [
        { amount: -100, category_id: cat },
        { amount: -200, category_id: cat },
      ],
    });
    const res = await bulkOk(b, { op: "delete", ids: [t.id, t.transfer_transaction_id, s.id] });
    expect(res.changed).toEqual([t.id, t.transfer_transaction_id, s.id]);
    expect(res.others).toEqual([]);
    expect(
      (
        await q(
          "select count(*) n from transactions where budget_id = ? and deleted_at is null and id in (?, ?)",
          b,
          t.id,
          t.transfer_transaction_id,
        )
      )[0]?.n,
    ).toBe(0);
    expect(
      (
        await q(
          "select count(*) n from transactions where parent_transaction_id = ? and deleted_at is null",
          s.id,
        )
      )[0]?.n,
    ).toBe(0);
    expect(
      (await changeLogOf(t.transfer_transaction_id)).filter((l) => l.action === "delete"),
    ).toHaveLength(1);
    const one = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    const r2 = await bulkOk(b, { op: "delete", ids: [one.id] });
    expect(r2.others).toEqual([one.transfer_transaction_id]);
    expect((await json(`${BID(b)}/transactions/${one.transfer_transaction_id}`)).status).toBe(404);
  });

  it("an imported row leaves a tombstone", async () => {
    const b = await plan();
    const a1 = await account(b);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100, approved: false });
    await setSql(r.id, "import_id = 'zz-del', source = 'plaid'");
    await bulkOk(b, { op: "delete", ids: [r.id] });
    const t = await q("select reason from import_tombstones where import_id = 'zz-del'");
    expect(t).toEqual([{ reason: "deleted" }]);
  });
});

describe("duplicate", () => {
  it("copies an import as an approved hand-entered row", async () => {
    const b = await plan();
    const a1 = await account(b);
    const r = await tx(b, {
      account_id: a1,
      date: DAY,
      amount: -100,
      memo: "m",
      cleared: "cleared",
      approved: false,
    });
    await setSql(
      r.id,
      "import_id = 'zz-dup', source = 'plaid', imported_payee = 'P', bank_description = 'D', flag_color = 'red'",
    );
    const res = await bulkOk(b, { op: "duplicate", ids: [r.id] });
    const copy = res.transactions[0];
    expect(res.copies).toEqual([{ id: r.id, copy_id: copy.id }]);
    expect(copy).toMatchObject({
      approved: true,
      import_id: null,
      source: null,
      imported_payee: null,
      bank_description: null,
      flag_color: null,
      memo: "m",
      cleared: "cleared",
      amount: -100,
    });
    expect(await changeLogOf(copy.id)).toEqual([
      { actor: "user:tester@localhost", action: "create" },
    ]);
  });

  it("copies a split with equal lines and a transfer as a new pair", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const cat = await category(b);
    const s = await tx(b, {
      account_id: a1,
      date: DAY,
      amount: -300,
      subtransactions: [
        { amount: -100, category_id: cat, memo: "l1" },
        { amount: -200, category_id: cat },
      ],
    });
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    const res = await bulkOk(b, { op: "duplicate", ids: [s.id, t.id, t.transfer_transaction_id] });
    const [cs, ct, ct2] = res.transactions;
    expect(cs.subtransactions.map((l: Json) => [l.amount, l.memo])).toEqual([
      [-100, "l1"],
      [-200, null],
    ]);
    expect(cs.subtransactions[0].id).not.toBe(s.subtransactions[0].id);
    expect(res.copies).toHaveLength(3);
    expect(ct.transfer_transaction_id).not.toBeNull();
    expect(ct.transfer_transaction_id).not.toBe(t.transfer_transaction_id);
    const side = await get(b, ct.transfer_transaction_id);
    expect(side).toMatchObject({ transfer_transaction_id: ct.id, account_id: a2, amount: 1000 });
    expect(res.transactions).toHaveLength(3);
    expect(ct2.id).toBe(ct.transfer_transaction_id);
  });
});

describe("tools", () => {
  it("run the same service with an mcp: actor", async () => {
    const b = await plan();
    const a1 = await account(b);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100 });
    const f = await tool("flag_transactions", { budget_id: b, ids: [r.id], color: "green" });
    expect(f.result.isError).not.toBe(true);
    expect((await get(b, r.id)).flag_color).toBe("green");
    expect((await changeLogOf(r.id)).at(-1)?.actor.startsWith("mcp:")).toBe(true);
    const m = await tool("bulk_update_transactions", {
      budget_id: b,
      ids: [r.id],
      op: "memo",
      value: "t",
    });
    expect(m.result.isError).not.toBe(true);
    expect((await get(b, r.id)).memo).toBe("t");
    const bad = await tool("bulk_update_transactions", {
      budget_id: b,
      ids: [r.id],
      op: "categorize",
    });
    expect(bad.result.isError).toBe(true);
    const d = await tool("delete_transactions", { budget_id: b, ids: [r.id] });
    expect(d.result.isError).not.toBe(true);
    expect(
      (await q("select deleted_at from transactions where id = ?", r.id))[0]?.deleted_at,
    ).not.toBeNull();
    const g = await tool("get_transaction", { budget_id: b, transaction_id: r.id });
    expect(g.result.isError).toBe(true);
  });
});
