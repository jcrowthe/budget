import { describe, expect, it } from "vitest";
import {
  account,
  accountOn,
  actor,
  cats,
  countLogs,
  fixture,
  getAccount,
  importOk,
  importText,
  type Json,
  logRows,
  payeeList,
  plan,
  preview,
  q,
  rowsOf,
  rtaOf,
  send,
  setSqlOf,
  TODAY,
  tx,
} from "./file-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";

pinPlanClock();

const plans = (bid: string) => `/api/v1/budgets/${bid}`;

describe("file import (EXF-531 AC6)", () => {
  it("imports the sample as cleared, unapproved file rows needing attention", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const before = await getAccount(bid, aid);
    const { result } = await importText(bid, aid, "sample.csv", fixture("sample.csv"));
    expect(result).toEqual({ imported: 2, matched: 0, skipped: 0 });
    const rows = (await rowsOf(aid)).filter((r) => r.source === "file");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ cleared: "cleared", approved: 0, source: "file" });
      expect(r.import_id.startsWith("file:v1:")).toBe(true);
    }
    const after = await getAccount(bid, aid);
    expect(after.unapproved_count - before.unapproved_count).toBe(2);
    expect(after.needs_attention_count - before.needs_attention_count).toBe(2);
    const list = (await (
      await send(`${plans(bid)}/transactions?needs=approval_or_category`, "GET")
    ).json()) as Json;
    const ids = (list.data.transactions as Json[]).map((t) => t.id);
    for (const r of rows) expect(ids).toContain(r.id);
    const payroll = rows.find((r) => r.payee_name === "Sample Payroll");
    const cafe = rows.find((r) => r.payee_name === "Sample Cafe");
    expect(payroll?.inflow_to_ready_to_assign).toBe(1);
    expect(cafe?.category_id).toBeNull();
    expect(cafe?.import_memo).toBe("latte");
  });
});

describe("worked example (EXF-531 AC7)", () => {
  async function world() {
    const bid = await plan();
    const aid = await accountOn(bid, 530000);
    const cat = (await cats(bid)).Groceries as string;
    await tx(bid, {
      account_id: aid,
      date: "2026-11-11",
      amount: -260000,
      payee_name: "ZZ-TEST Hand",
    });
    const corner = await tx(bid, {
      account_id: aid,
      date: "2026-11-15",
      amount: -20000,
      payee_name: "ZZ-TEST Corner Market",
      memo: "hand memo",
      category_id: cat,
    });
    return { bid, aid, cat, corner };
  }

  it("gives {2, 1, 0}, the balances, +250.00 to Ready to Assign, and merges Corner Market", async () => {
    const { bid, aid, cat, corner } = await world();
    const before = await getAccount(bid, aid);
    expect(before.cleared_balance).toBe(530000);
    expect(before.uncleared_balance).toBe(-280000);
    const rta0 = await rtaOf(bid);
    const { result } = await importText(bid, aid, "three-rows.csv", fixture("three-rows.csv"));
    expect(result).toEqual({ imported: 2, matched: 1, skipped: 0 });
    const a = await getAccount(bid, aid);
    expect(a.cleared_balance).toBe(755500);
    expect(a.uncleared_balance).toBe(-260000);
    expect(a.balance).toBe(495500);
    expect((await rtaOf(bid)) - rta0).toBe(250000);
    const [m] = await q("select * from transactions where id = ?", corner.id);
    expect(m).toMatchObject({
      payee_name: "ZZ-TEST Corner Market",
      memo: "hand memo",
      category_id: cat,
      cleared: "cleared",
      approved: 1,
      amount: -20000,
      date: "2026-11-15",
      import_memo: null,
    });
    expect(m.import_id.startsWith("file:v1:")).toBe(true);
    expect(m.source).toBeNull();
    const got = (await (
      await send(`${plans(bid)}/transactions/${corner.id}`, "GET")
    ).json()) as Json;
    expect(got.data.transaction.matched).toBe(true);
  });

  it("re-import: imported 0, matched = rows, nothing new and no new change_log row (AC4)", async () => {
    const { bid, aid } = await world();
    const first = await preview(bid, aid, "three-rows.csv", fixture("three-rows.csv"), {
      today: TODAY,
    });
    await importOk(bid, aid, first.file_id);
    const rows0 = (await rowsOf(aid)).length;
    const logs0 = await countLogs(bid);
    expect(await importOk(bid, aid, first.file_id)).toEqual({
      imported: 0,
      matched: 3,
      skipped: 0,
    });
    const again = await importText(bid, aid, "three-rows.csv", fixture("three-rows.csv"));
    expect(again.result).toEqual({ imported: 0, matched: 3, skipped: 0 });
    expect((await rowsOf(aid)).length).toBe(rows0);
    expect(await countLogs(bid)).toBe(logs0);
  });
});

describe("merging a split hand row", () => {
  it("the lines follow the parent: cleared and approved, and the log carries them", async () => {
    const bid = await plan();
    const aid = await accountOn(bid, 530000);
    const c = await cats(bid);
    const parent = await tx(bid, {
      account_id: aid,
      date: "2026-11-15",
      amount: -20000,
      payee_name: "ZZ-TEST Split Market",
      subtransactions: [
        { amount: -12000, category_id: c.Groceries },
        { amount: -8000, category_id: c.Fun },
      ],
    });
    const { result } = await importText(bid, aid, "three-rows.csv", fixture("three-rows.csv"));
    expect(result).toEqual({ imported: 2, matched: 1, skipped: 0 });
    const lines = await q(
      "select cleared, approved from transactions where parent_transaction_id = ?",
      parent.id,
    );
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toMatchObject({ cleared: "cleared", approved: 1 });
    const log = (await logRows(bid, "transaction")).find(
      (l) => l.entity_id === parent.id && l.action === "update",
    );
    expect(JSON.parse(log?.after_json).subtransactions).toHaveLength(2);
  });
});

describe("the cutoff (AC5)", () => {
  it("skips the row before the Starting Balance", async () => {
    const bid = await plan();
    const aid = await accountOn(bid, 100000, "2026-11-11");
    const { result } = await importText(bid, aid, "sample.csv", fixture("sample.csv"));
    expect(result).toEqual({ imported: 1, matched: 0, skipped: 1 });
  });

  it("include_before_start imports both and moves the Starting Balance back", async () => {
    const bid = await plan();
    const aid = await accountOn(bid, 100000, "2026-11-11");
    const [sb0] = await q(
      "select t.id, t.date from transactions t join payees p on p.id = t.payee_id where t.account_id = ? and p.system = 'starting_balance'",
      aid,
    );
    const start0 = (await q("select import_start_date from accounts where id = ?", aid))[0]
      ?.import_start_date;
    const { result } = await importText(bid, aid, "sample.csv", fixture("sample.csv"), {
      include_before_start: true,
    });
    expect(result).toEqual({ imported: 2, matched: 0, skipped: 0 });
    const [sb1] = await q("select date from transactions where id = ?", sb0.id);
    expect(sb1.date).toBe("2026-11-10");
    const updates = (await logRows(bid, "transaction")).filter(
      (l) => l.entity_id === sb0.id && l.action === "update",
    );
    expect(updates).toHaveLength(1);
    expect(
      (await q("select import_start_date from accounts where id = ?", aid))[0]?.import_start_date,
    ).toBe(start0);
  });
});

async function patchPayee(bid: string, name: string, body: Json) {
  const p = (await payeeList(bid)).find((x) => x.name === name);
  const res = await send(`${plans(bid)}/payees/${p?.id}`, "PATCH", body);
  expect(res.status).toBe(200);
  return p?.id as string;
}

const csv = (...lines: string[]) => ["Date,Payee,Memo,Outflow,Inflow", ...lines].join("\n");

describe("payee defaults on import (EXF-515 AC6)", () => {
  it("history, fixed and new payees", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const c = await cats(bid);
    const hand = (payee: string, date: string, category: string) =>
      tx(bid, {
        account_id: aid,
        date,
        amount: -1000,
        payee_name: payee,
        category_id: c[category],
      });
    await hand("ZZ Shop", "2026-11-10", "Groceries");
    await hand("ZZ Shop", "2026-11-11", "Groceries");
    await hand("ZZ Shop", "2026-11-12", "Fun");
    await hand("ZZ Phone Co", "2026-11-10", "Phone");
    await patchPayee(bid, "ZZ Phone Co", { category_mode: "fixed", fixed_category_id: c.Fun });
    await importText(
      bid,
      aid,
      "a.csv",
      csv(
        "11/20/2026,ZZ Shop,,7.77,",
        "11/21/2026,ZZ Phone Co,,8.88,",
        "11/22/2026,ZZ-TEST Brand New,,9.99,",
      ),
    );
    const by = async (name: string) =>
      (await rowsOf(aid)).find((r) => r.payee_name === name && r.source === "file");
    expect((await by("ZZ Shop"))?.category_id).toBe(c.Groceries);
    expect((await by("ZZ Phone Co"))?.category_id).toBe(c.Fun);
    expect((await by("ZZ-TEST Brand New"))?.category_id).toBeNull();
  });
});

describe("renaming rules on import (EXF-518 AC1, AC5)", () => {
  it("the table's six rows, and a matched row keeps the hand payee", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const c = await cats(bid);
    const hand = (payee: string, date: string, category: string | null, amount = -1000) =>
      tx(bid, {
        account_id: aid,
        date,
        amount,
        payee_name: payee,
        category_id: category ? c[category] : null,
      });
    await hand("ZZ Phone Co", "2026-10-01", "Phone");
    await hand("ZZ Shop", "2026-10-02", "Groceries");
    await hand("ZZ Shop", "2026-10-03", "Groceries");
    await hand("ZZ Gym", "2026-10-04", "Fun");
    await hand("ZZ Cafe A", "2026-11-12", null, -2000);
    const ids = {
      phone: await patchPayee(bid, "ZZ Phone Co", {
        category_mode: "fixed",
        fixed_category_id: c.Fun,
      }),
      shop: (await payeeList(bid)).find((p) => p.name === "ZZ Shop")?.id as string,
    };
    const rule = async (payeeId: string, kind: string, text: string) => {
      const res = await send(`${plans(bid)}/payees/${payeeId}/rename-rules`, "POST", {
        kind,
        text,
      });
      expect(res.status).toBe(201);
      await new Promise((ok) => setTimeout(ok, 3));
      return ((await res.json()) as Json).data.rule.id as string;
    };
    const rContains = await rule(ids.phone, "contains", "PHONECO");
    const rIs = await rule(ids.phone, "is", "ZZ PHONE COMPANY LLC");
    const rPaper = await rule(ids.shop, "contains", "PAPERCO");

    await importText(
      bid,
      aid,
      "t.csv",
      csv(
        "11/20/2026,zz phone company llc,,3.01,",
        "11/20/2026,ZZ PHONE COMPANY LLC #2,,3.02,",
        "11/20/2026,ZZ PAPERCO STORE,,3.03,",
        "11/20/2026,ZZ phoneco lower,,3.04,",
        "11/20/2026,ZZ Gym,,3.05,",
        "11/20/2026,ZZ Brand New Vendor,,3.06,",
        "11/12/2026,ZZ XYZ PHONECO 1234,,2.00,",
      ),
    );
    const rows = await rowsOf(aid);
    const created = (amount: number) =>
      rows.find((r) => r.amount === amount && r.source === "file");
    expect(created(-3010)).toMatchObject({ payee_name: "ZZ Phone Co", category_id: c.Fun });
    expect(created(-3020)?.payee_name).toBe("Zz Phone Company Llc #2");
    expect(created(-3030)).toMatchObject({ payee_name: "ZZ Shop", category_id: c.Groceries });
    expect(created(-3040)).toMatchObject({ payee_name: "ZZ Phone Co", category_id: c.Fun });
    expect(created(-3050)).toMatchObject({ payee_name: "ZZ Gym" });
    expect(created(-3060)?.payee_name).toBe("ZZ Brand New Vendor");
    const merged = rows.find((r) => r.amount === -2000 && r.payee_name === "ZZ Cafe A");
    expect(merged?.import_id).toMatch(/^file:v1:/);
    expect(merged?.source).toBeNull();

    const txLogs = await logRows(bid, "transaction");
    const createLog = (id: string) =>
      JSON.parse(txLogs.find((l) => l.entity_id === id && l.action === "create")?.after_json);
    expect(createLog(created(-3010)?.id).rename_rule_id).toBe(rIs);
    expect(createLog(created(-3030)?.id).rename_rule_id).toBe(rPaper);
    expect(createLog(created(-3040)?.id).rename_rule_id).toBe(rContains);
    expect(createLog(created(-3050)?.id).rename_rule_id).toBeUndefined();
    const mergeLog = txLogs.find((l) => l.entity_id === merged?.id && l.action === "update");
    expect(JSON.parse(mergeLog?.after_json).rename_rule_id).toBeUndefined();
    expect(JSON.parse(mergeLog?.after_json).payee_name).toBe("ZZ Cafe A");
  });

  it("EXF-518 AC4: a POST keeps the payee name as typed", async () => {
    const bid = await plan();
    const aid = await account(bid);
    await tx(bid, {
      account_id: aid,
      date: "2026-11-01",
      amount: -1000,
      payee_name: "ZZ Phone Co",
    });
    const id = (await payeeList(bid)).find((p) => p.name === "ZZ Phone Co")?.id;
    await send(`${plans(bid)}/payees/${id}/rename-rules`, "POST", {
      kind: "contains",
      text: "PHONECO",
    });
    const t = await tx(bid, {
      account_id: aid,
      date: "2026-11-02",
      amount: -500,
      payee_name: "XX PHONECO 99",
    });
    expect(t.payee_name).toBe("XX PHONECO 99");
  });
});

describe("tombstones (AC9)", () => {
  it("a rejected or hand-deleted imported row stays out and counts as matched", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const p = await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY });
    await importOk(bid, aid, p.file_id);
    const [one, two] = (await rowsOf(aid)).filter((r) => r.source === "file");
    const rej = await send(`${plans(bid)}/transactions/reject`, "POST", { ids: [one?.id] });
    expect(rej.status, await rej.text()).toBe(200);
    const del = await send(`${plans(bid)}/transactions/${two?.id}`, "DELETE");
    expect(del.status).toBe(200);
    const n = (await rowsOf(aid)).length;
    expect(await importOk(bid, aid, p.file_id)).toEqual({ imported: 0, matched: 2, skipped: 0 });
    expect((await rowsOf(aid)).length).toBe(n);
  });
});

describe("a Direct Import duplicate (AC10)", () => {
  it("skips a file row equal to a plaid row", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const t = await tx(bid, {
      account_id: aid,
      date: "2026-11-10",
      amount: -12340,
      payee_name: "ZZ Bank Row",
    });
    await setSqlOf(t.id, "source = 'plaid', import_id = 'plaid-ZZ-1'");
    const { result } = await importText(bid, aid, "a.csv", csv("11/10/2026,ZZ Bank Row,,12.34,"));
    expect(result).toEqual({ imported: 0, matched: 0, skipped: 1 });
    expect((await rowsOf(aid)).filter((r) => r.source === "file")).toHaveLength(0);
  });
});

describe("OFX (AC11)", () => {
  it("keys on the FITID and survives a memo edit", async () => {
    for (const name of ["sgml.ofx", "xml.ofx"]) {
      const bid = await plan();
      const aid = await account(bid);
      const { result } = await importText(bid, aid, name, fixture(name));
      expect(result.imported).toBeGreaterThan(0);
      const rows = (await rowsOf(aid)).filter((r) => r.source === "file");
      const keyed = rows.filter((r) => r.import_id.includes(":fitid:"));
      expect(keyed.length).toBeGreaterThan(0);
      for (const r of keyed)
        expect(r.import_id).toMatch(new RegExp(`^file:v1:${aid}:fitid:ZZ\\d+`));
      const first = /<MEMO>(\w+)/.exec(fixture(name))?.[1] as string;
      const target = keyed.find((r) => r.import_memo === first);
      expect(target, `a keyed row with the memo ${first}`).toBeDefined();
      const res = await send(`${plans(bid)}/transactions/${target?.id}`, "PATCH", {
        memo: "edited",
      });
      expect(res.status).toBe(200);
      const edited = fixture(name).replace(/<MEMO>(\w+)/, "<MEMO>$1 edited");
      const again = await importText(bid, aid, name, edited);
      expect(again.result.imported).toBe(0);
    }
  });
});

describe("change_log (AC13)", () => {
  it("one create per row and payee, one update per merge, the SB move and the settings", async () => {
    const bid = await plan();
    const aid = await accountOn(bid, 100000, "2026-11-12");
    await tx(bid, {
      account_id: aid,
      date: "2026-11-15",
      amount: -20000,
      payee_name: "ZZ-TEST Corner Market",
    });
    await importText(bid, aid, "three-rows.csv", fixture("three-rows.csv"), {
      include_before_start: true,
    });
    const txl = await logRows(bid, "transaction");
    const imports = txl.filter((l) => l.actor === actor);
    expect(imports.filter((l) => l.action === "create").length).toBeGreaterThanOrEqual(3);
    expect(txl.filter((l) => l.action === "update")).toHaveLength(2);
    const pl = (await logRows(bid, "payee")).filter((l) => l.actor === actor);
    expect(pl.map((l) => JSON.parse(l.after_json).name).sort()).toEqual(
      expect.arrayContaining(["Sample Cafe", "Sample Payroll"]),
    );
    const st = await logRows(bid, "account_import_settings");
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ action: "create", actor });
    expect(st[0]?.entity_id).toBe(`${aid}:csv`);
    const created = (await rowsOf(aid)).filter((r) => r.source === "file");
    expect(created).toHaveLength(2);
    expect(
      txl.filter((l) => l.action === "create" && created.some((r) => r.id === l.entity_id)),
    ).toHaveLength(2);
  });
});
