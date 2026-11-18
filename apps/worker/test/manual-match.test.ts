import { beforeEach, describe, expect, it } from "vitest";
import { tool } from "./account-helpers";
import { json } from "./helpers";
import {
  agrees,
  balanceOf,
  getTx,
  live,
  MATCH,
  post,
  snapshot,
  sqlImport,
  UNMATCH,
} from "./manual-match-helpers";
import { plaidTxn } from "./plaid-stub";
import {
  data,
  feed,
  hand,
  type Json,
  q,
  REST_ACTOR,
  rows,
  setupPlaid,
  stubBank,
  syncOne,
  TX,
  world1,
} from "./plaid-sync-helpers";
import { apiPaths, listedToolNames } from "./surface";

beforeEach(async () => {
  await setupPlaid();
  stubBank();
});

/** Hand −12.34 against a bank 13.00, 20 days apart: the owner's word is what matches them. */
async function pairWorld() {
  const w = await world1();
  const m = await data(await json(`/api/v1/budgets/${w.plan}/months/2026-03-01`));
  const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
  const b0 = await balanceOf(w.plan, w.account);
  const entry = (
    await data(
      await hand(w.plan, {
        account_id: w.account,
        date: "2026-03-12",
        amount: -12340,
        payee_name: "ZZ Cafe",
        memo: "ZZ memo",
        category_id: cat,
      }),
    )
  ).transaction as Json;
  await post(`${TX(w.plan)}/bulk`, { op: "flag", ids: [entry.id], value: "red" });
  const b1 = await balanceOf(w.plan, w.account);
  feed.pages = [
    {
      added: [
        plaidTxn({
          transaction_id: "ZZ-BANK-1",
          amount: 13,
          date: "2026-04-01",
          name: "ZZ Bank Cafe",
          merchant_name: "ZZ Bank Cafe",
        }),
      ],
    },
  ];
  const r = await syncOne(w.plan, w.conn);
  expect(r).toMatchObject({ added: 1, matched: 0 });
  const b2 = await balanceOf(w.plan, w.account);
  const imp = (await rows(w.account)).find((x) => x.import_id === "ZZ-BANK-1") as Json;
  return { ...w, cat, entry, imp, b0, b1, b2 };
}

describe("match by hand (EXF-464)", () => {
  it("1: 12.34 by hand and 13.00 from the bank become one row of 13.00", async () => {
    const { plan, account, cat, entry, imp, b0, b1, b2 } = await pairWorld();
    // figures: the entry alone moves the balance by −12.34, the import by −13.00 more
    expect(b1).toBe(b0 - 12340);
    expect(b2).toBe(b0 - 25340);

    const res = await post(MATCH(plan), { ids: [entry.id, imp.id] });
    expect(res.status).toBe(200);
    const out = (await data(res)) as Json;
    expect(out.transaction).toMatchObject({
      id: entry.id,
      amount: -13000,
      payee_name: "ZZ Cafe",
      memo: "ZZ memo",
      date: "2026-03-12",
      category_id: cat,
      flag_color: "red",
      cleared: "cleared",
      approved: true,
      matched: true,
      source: null,
      import_id: "ZZ-BANK-1",
      imported_payee: "ZZ Bank Cafe",
      match_details: { date: "2026-04-01", amount: -13000, payee_name: "ZZ Bank Cafe" },
    });
    expect(out.removed).toMatchObject({ id: imp.id, amount: -13000, approved: false });
    // one row gone, and the balance moved by exactly the difference (−13.00 − −12.34 = −0.66 from B1)
    expect(await live(account)).toHaveLength(2); // the Starting Balance and the matched row
    expect(await balanceOf(plan, account)).toBe(b0 - 13000);
    expect(await balanceOf(plan, account)).toBe(b1 - 660);
    // the reads carry match_details, the unmatched rows null
    expect((await getTx(plan, entry.id)).match_details).toEqual({
      date: "2026-04-01",
      amount: -13000,
      payee_name: "ZZ Bank Cafe",
    });
    const list = (
      await data(await json(`/api/v1/budgets/${plan}/accounts/${account}/transactions`))
    ).transactions as Json[];
    expect(list.find((t) => t.id === entry.id)?.match_details?.amount).toBe(-13000);
    expect(list.filter((t) => t.match_details === null)).toHaveLength(1);
    // the history: an update of the entry and a delete of the import, by the REST actor
    const log = await q(
      "select entity_id, action, actor from change_log where entity_id in (?, ?) and action in ('update','delete') order by rowid",
      entry.id,
      imp.id,
    );
    expect(log.filter((l) => l.entity_id === entry.id && l.actor === REST_ACTOR)).toHaveLength(2); // flag + match
    expect(log.find((l) => l.entity_id === imp.id)).toMatchObject({
      action: "delete",
      actor: REST_ACTOR,
    });
  });

  it("5: any distance and any amount: 40 days apart, −1.00 against −99.00", async () => {
    const { plan, account } = await world1();
    const e = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-11",
          amount: -1000,
          payee_name: "ZZ Far",
        }),
      )
    ).transaction as Json;
    const i = await sqlImport(plan, account, { date: "2026-04-20", amount: -99000 });
    const res = await post(MATCH(plan), { ids: [i.id, e.id] });
    expect(res.status).toBe(200);
    expect((await data(res)).transaction).toMatchObject({
      id: e.id,
      amount: -99000,
      date: "2026-03-11",
      matched: true,
    });
  });

  it("6: a split of the bank's total matches, one that differs does not; a transfer likewise", async () => {
    const { plan, account } = await world1();
    const m = await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`));
    const [c1, c2] = m.groups.flatMap((g: Json) => g.categories).map((c: Json) => c.id);
    const split = async (total: number, payee: string) =>
      (
        await data(
          await hand(plan, {
            account_id: account,
            date: "2026-03-12",
            amount: total,
            payee_name: payee,
            subtransactions: [
              { amount: -5000, category_id: c1 },
              { amount: total + 5000, category_id: c2 },
            ],
          }),
        )
      ).transaction as Json;
    const ok = await split(-13000, "ZZ Split Same");
    const i1 = await sqlImport(plan, account, { amount: -13000 });
    const res = await post(MATCH(plan), { ids: [ok.id, i1.id] });
    expect(res.status).toBe(200);
    const lines = await q(
      "select cleared, approved from transactions where parent_transaction_id = ? and deleted_at is null",
      ok.id,
    );
    expect(lines).toEqual([
      { cleared: "cleared", approved: 1 },
      { cleared: "cleared", approved: 1 },
    ]);

    const bad = await split(-12000, "ZZ Split Diff");
    const i2 = await sqlImport(plan, account, { amount: -13000 });
    const before = await snapshot(plan);
    const refused = await post(MATCH(plan), { ids: [bad.id, i2.id] });
    expect(refused.status).toBe(422);
    expect(await snapshot(plan)).toEqual(before);
    await agrees(plan, [bad.id, i2.id], refused);

    // a transfer: the other side is not written
    const savings = (
      await data(
        await json(
          `/api/v1/budgets/${plan}/accounts`,
          { method: "POST" },
          { name: "ZZ Sav", type: "savings", balance: 0, date: "2026-03-10" },
        ),
      )
    ).account.id as string;
    const tr = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -7000,
          transfer_account_id: savings,
        }),
      )
    ).transaction as Json;
    const other = await q("select * from transactions where id = ?", tr.transfer_transaction_id);
    const i3 = await sqlImport(plan, account, { amount: -7000 });
    expect((await post(MATCH(plan), { ids: [tr.id, i3.id] })).status).toBe(200);
    expect(await q("select * from transactions where id = ?", tr.transfer_transaction_id)).toEqual(
      other,
    );

    const tr2 = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -8000,
          transfer_account_id: savings,
        }),
      )
    ).transaction as Json;
    const i4 = await sqlImport(plan, account, { amount: -9000 });
    const snap = await snapshot(plan);
    const r4 = await post(MATCH(plan), { ids: [tr2.id, i4.id] });
    expect(r4.status).toBe(422);
    expect(await snapshot(plan)).toEqual(snap);
    await agrees(plan, [tr2.id, i4.id], r4);
  });

  it("4: every refusal answers its status and words, writes nothing, and the pure rule agrees", async () => {
    const { plan, account } = await world1();
    const mkEntry = async (payee: string, amount = -12340, over: Json = {}) =>
      (
        await data(
          await hand(plan, {
            account_id: account,
            date: "2026-03-12",
            amount,
            payee_name: payee,
            ...over,
          }),
        )
      ).transaction as Json;
    const expectRefused = async (ids: string[], status: number, name: string) => {
      const before = await snapshot(plan);
      const res = await post(MATCH(plan), { ids });
      expect(res.status).toBe(status);
      const copy = res.clone();
      expect(((await copy.json()) as Json).error.name).toBe(name);
      expect(await snapshot(plan)).toEqual(before);
      await agrees(plan, ids, res);
    };

    // 1: two accounts
    const other = (
      await data(
        await json(
          `/api/v1/budgets/${plan}/accounts`,
          { method: "POST" },
          { name: "ZZ Other", type: "checking", balance: 0, date: "2026-03-10" },
        ),
      )
    ).account.id as string;
    const away = (
      await data(
        await hand(plan, {
          account_id: other,
          date: "2026-03-12",
          amount: -1000,
          payee_name: "ZZ Away",
        }),
      )
    ).transaction as Json;
    const i1 = await sqlImport(plan, account);
    await expectRefused([i1.id, away.id], 422, "not_matchable");
    // 3: already matched
    const e1 = await mkEntry("ZZ One");
    const i2 = await sqlImport(plan, account);
    expect((await post(MATCH(plan), { ids: [e1.id, i2.id] })).status).toBe(200);
    const i3 = await sqlImport(plan, account);
    await expectRefused([e1.id, i3.id], 422, "not_matchable");
    // 4: two entries, two imports
    const e2 = await mkEntry("ZZ Two");
    const e3 = await mkEntry("ZZ Three");
    await expectRefused([e2.id, e3.id], 422, "not_matchable");
    const i4 = await sqlImport(plan, account);
    await expectRefused([i3.id, i4.id], 422, "not_matchable");
    // 5: approved import
    const ia = await sqlImport(plan, account, { approved: 1 });
    await expectRefused([e2.id, ia.id], 422, "not_matchable");
    // 6: split import, transfer import
    const is = await sqlImport(plan, account);
    await q(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, parent_transaction_id, split_index) values ('zz-line-1', ?, ?, '2026-03-20', -13000, 'cleared', 0, '2026-03-20T00:00:00.000Z', '2026-03-20T00:00:00.000Z', ?, 0)",
      plan,
      account,
      is.id,
    );
    await expectRefused([e2.id, is.id], 422, "not_matchable");
    const it = await sqlImport(plan, account);
    await q("update transactions set transfer_account_id = ? where id = ?", other, it.id);
    await expectRefused([e2.id, it.id], 422, "not_matchable");
    // 7: reconciled import
    const ir = await sqlImport(plan, account, { cleared: "reconciled" });
    await expectRefused([e2.id, ir.id], 409, "transaction_reconciled");
    // 8c: reconciled entry whose amount would change
    const er = await mkEntry("ZZ Rec");
    await q("update transactions set cleared = 'reconciled' where id = ?", er.id);
    const i8 = await sqlImport(plan, account, { amount: -15000 });
    await expectRefused([er.id, i8.id], 409, "transaction_reconciled");
    // with an equal amount a reconciled entry matches and stays reconciled
    const i9 = await sqlImport(plan, account, { amount: -12340 });
    const ok = await post(MATCH(plan), { ids: [er.id, i9.id] });
    expect(ok.status).toBe(200);
    expect((await data(ok)).transaction).toMatchObject({ cleared: "reconciled", matched: true });
    // 0: unknown ids and the same id twice
    expect((await post(MATCH(plan), { ids: [e3.id, "nope"] })).status).toBe(404);
    expect((await post(MATCH(plan), { ids: [e3.id, e3.id] })).status).toBe(422);
    expect((await post(MATCH(plan), { ids: [e3.id] })).status).toBe(422);
    // 2: a closed account
    const e4 = await mkEntry("ZZ Four");
    const i10 = await sqlImport(plan, account);
    await q("update accounts set closed = 1 where id = ?", account);
    await expectRefused([e4.id, i10.id], 422, "account_closed");
  });

  it("a deleted row is not found and writes nothing", async () => {
    const { plan, account } = await world1();
    const e = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -1000,
          payee_name: "ZZ Gone",
        }),
      )
    ).transaction as Json;
    const i = await sqlImport(plan, account);
    await json(`${TX(plan)}/${e.id}`, { method: "DELETE" });
    const before = await snapshot(plan);
    expect((await post(MATCH(plan), { ids: [e.id, i.id] })).status).toBe(404);
    expect(await snapshot(plan)).toEqual(before);
  });
});

describe("unmatch (EXF-464)", () => {
  it("2: 12.34 and 13.00 come back, the import unapproved", async () => {
    const { plan, account, cat, entry, imp, b0 } = await pairWorld();
    expect((await post(MATCH(plan), { ids: [entry.id, imp.id] })).status).toBe(200);
    const res = await post(UNMATCH(plan, entry.id));
    expect(res.status).toBe(200);
    const out = (await data(res)) as Json;
    // the entry has the amount it had before the match, and its own fields
    expect(out.transaction).toMatchObject({
      id: entry.id,
      amount: -12340,
      cleared: "uncleared",
      approved: true,
      payee_name: "ZZ Cafe",
      memo: "ZZ memo",
      date: "2026-03-12",
      category_id: cat,
      flag_color: "red",
      import_id: null,
      matched: false,
      match_details: null,
    });
    // the import: the bank's date, amount and payee, unapproved, no category
    expect(out.imported).toMatchObject({
      amount: -13000,
      date: "2026-04-01",
      payee_name: "ZZ Bank Cafe",
      approved: false,
      cleared: "cleared",
      source: "plaid",
      import_id: "ZZ-BANK-1",
      category_id: null,
      matched: false,
      match_details: null,
    });
    expect(out.imported.id).not.toBe(entry.id);
    expect(await balanceOf(plan, account)).toBe(b0 - 25340);
    expect(await live(account)).toHaveLength(3);
    const log = await q(
      "select entity_id, action, actor from change_log where entity_id in (?, ?) order by rowid",
      entry.id,
      out.imported.id,
    );
    expect(log.filter((l) => l.action === "update" && l.actor === REST_ACTOR).length).toBe(3); // flag, match, unmatch
    expect(log.find((l) => l.entity_id === out.imported.id)).toMatchObject({
      action: "create",
      actor: REST_ACTOR,
    });
    // matched again: the pair can be matched once more
    expect((await post(MATCH(plan), { ids: [entry.id, out.imported.id] })).status).toBe(200);
  });

  it("an automatic match unmatches to the entry's own amount (462-13 setup)", async () => {
    const { plan, conn, account } = await world1();
    const e = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-10",
          amount: -12340,
          payee_name: "ZZ Hand",
        }),
      )
    ).transaction as Json;
    feed.pages = [
      {
        added: [
          plaidTxn({
            transaction_id: "ZZ-AUTO",
            amount: 12.34,
            date: "2026-03-13",
            name: "ZZ Bank Name",
          }),
        ],
      },
    ];
    expect(await syncOne(plan, conn)).toMatchObject({ matched: 1, added: 0 });
    const res = await post(UNMATCH(plan, e.id));
    expect(res.status).toBe(200);
    const out = (await data(res)) as Json;
    expect(out.transaction).toMatchObject({
      amount: -12340,
      payee_name: "ZZ Hand",
      cleared: "uncleared",
      matched: false,
    });
    expect(out.imported).toMatchObject({
      amount: -12340,
      date: "2026-03-13",
      payee_name: "ZZ Bank Name",
      import_id: "ZZ-AUTO",
      approved: false,
    });
  });

  it("refusals change nothing, and the pure rule agrees", async () => {
    const { plan, account } = await world1();
    const e = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -1000,
          payee_name: "ZZ Plain",
        }),
      )
    ).transaction as Json;
    const refuse = async (id: string, status: number, name: string) => {
      const before = await snapshot(plan);
      const res = await post(UNMATCH(plan, id));
      expect(res.status).toBe(status);
      expect(((await res.clone().json()) as Json).error.name).toBe(name);
      expect(await snapshot(plan)).toEqual(before);
      await agrees(plan, [id], res);
    };
    await refuse(e.id, 422, "not_matched");
    // a matched row: reconciled, closed, no record of the bank
    const i = await sqlImport(plan, account, { amount: -1000 });
    expect((await post(MATCH(plan), { ids: [e.id, i.id] })).status).toBe(200);
    await q("update transactions set import_date = null where id = ?", e.id);
    await refuse(e.id, 422, "not_matched");
    await q(
      "update transactions set import_date = '2026-03-20', cleared = 'reconciled' where id = ?",
      e.id,
    );
    await refuse(e.id, 409, "transaction_reconciled");
    await q("update transactions set cleared = 'cleared' where id = ?", e.id);
    await q("update accounts set closed = 1 where id = ?", account);
    await refuse(e.id, 422, "account_closed");
    expect((await post(UNMATCH(plan, "nope"))).status).toBe(404);
  });

  it("6: a matched split and a matched transfer keep their amount, lines and other side", async () => {
    const { plan, account } = await world1();
    const m = await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`));
    const [c1, c2] = m.groups.flatMap((g: Json) => g.categories).map((c: Json) => c.id);
    const sp = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -13000,
          payee_name: "ZZ Split",
          subtransactions: [
            { amount: -5000, category_id: c1 },
            { amount: -8000, category_id: c2 },
          ],
        }),
      )
    ).transaction as Json;
    const i = await sqlImport(plan, account, { amount: -13000 });
    expect((await post(MATCH(plan), { ids: [sp.id, i.id] })).status).toBe(200);
    const res = await post(UNMATCH(plan, sp.id));
    expect(res.status).toBe(200);
    const out = (await data(res)) as Json;
    expect(out.transaction).toMatchObject({ amount: -13000, cleared: "uncleared", matched: false });
    expect(out.transaction.subtransactions.map((l: Json) => l.amount)).toEqual([-5000, -8000]);
    const lines = await q(
      "select cleared from transactions where parent_transaction_id = ? and deleted_at is null",
      sp.id,
    );
    expect(lines).toEqual([{ cleared: "uncleared" }, { cleared: "uncleared" }]);

    const sav = (
      await data(
        await json(
          `/api/v1/budgets/${plan}/accounts`,
          { method: "POST" },
          { name: "ZZ Sav", type: "savings", balance: 0, date: "2026-03-10" },
        ),
      )
    ).account.id as string;
    const tr = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -7000,
          transfer_account_id: sav,
        }),
      )
    ).transaction as Json;
    const other = await q("select * from transactions where id = ?", tr.transfer_transaction_id);
    const i2 = await sqlImport(plan, account, { amount: -7000 });
    expect((await post(MATCH(plan), { ids: [tr.id, i2.id] })).status).toBe(200);
    const r2 = await post(UNMATCH(plan, tr.id));
    expect(r2.status).toBe(200);
    expect((await data(r2)).transaction).toMatchObject({ amount: -7000, transfer_account_id: sav });
    expect(await q("select * from transactions where id = ?", tr.transfer_transaction_id)).toEqual(
      other,
    );
  });
});

describe("the two tools (EXF-464)", () => {
  it("7: match_transactions and unmatch_transaction do the same, with mcp: actors", async () => {
    const { plan, account, cat, entry, imp, b0 } = await pairWorld();
    const matched = await tool("match_transactions", { budget_id: plan, ids: [entry.id, imp.id] });
    expect(matched.isError).toBeFalsy();
    const m = matched.structuredContent as Json;
    expect(m.transaction).toMatchObject({
      id: entry.id,
      amount: -13000,
      payee_name: "ZZ Cafe",
      category_id: cat,
      matched: true,
      match_details: { date: "2026-04-01", amount: -13000, payee_name: "ZZ Bank Cafe" },
    });
    expect(m.removed.id).toBe(imp.id);
    expect(await balanceOf(plan, account)).toBe(b0 - 13000);
    const log = await q(
      "select entity_id, action, actor from change_log where entity_id in (?, ?) and actor like 'mcp:%' order by rowid",
      entry.id,
      imp.id,
    );
    expect(log.map((l) => `${l.entity_id === entry.id ? "entry" : "import"} ${l.action}`)).toEqual([
      "entry update",
      "import delete",
    ]);

    const un = await tool("unmatch_transaction", { budget_id: plan, transaction_id: entry.id });
    expect(un.isError).toBeFalsy();
    const u = un.structuredContent as Json;
    expect(u.transaction).toMatchObject({ amount: -12340, cleared: "uncleared", matched: false });
    expect(u.imported).toMatchObject({ amount: -13000, approved: false, import_id: "ZZ-BANK-1" });
    expect(await balanceOf(plan, account)).toBe(b0 - 25340);
    const after = await q(
      "select action from change_log where actor like 'mcp:%' and entity_id in (?, ?) order by rowid",
      entry.id,
      u.imported.id,
    );
    expect(after.map((l) => l.action)).toEqual(["update", "update", "create"]);
    // a refusal is a tool error, naming the rows and not an id
    const bad = await tool("unmatch_transaction", { budget_id: plan, transaction_id: entry.id });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad)).toContain("is not matched");
    expect(JSON.stringify(bad)).not.toContain(entry.id);
  });

  it("the paths and the tools exist", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/transactions/match",
        "/api/v1/budgets/{budget_id}/transactions/{transaction_id}/unmatch",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["match_transactions", "unmatch_transaction"]),
    );
  });
});
