import { env } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";
import { importLimits } from "../src/services/plan-import";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { buildF, NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";
import { body, importForm, postImport, runToDone } from "./plan-import-helpers";
import { reconcile } from "./reconcile-helpers";

// EXF-477 criterion 7 (the main test): a plan built in a test, exported by the clone, imported, exported again:
// the Plan and Register rows are identical. Also criterion 5: the recomputed figures equal the file's.
pinPlanClock();

async function exportOf(bid: string) {
  const res = await json(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`);
  expect(res.status).toBe(200);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
}

const original = { chunk: importLimits.chunkRows };
afterAll(() => {
  importLimits.chunkRows = original.chunk;
});

describe("criterion 7: export, import, export", () => {
  it("gives identical Plan and Register files (single call)", async () => {
    const f = await buildF();
    const first = await exportOf(f.bid);
    // The first export holds what the round trip has to carry (EXF-477 criterion 7): a card with its payment
    // category, a split, a transfer, a scheduled row, a hidden category, a flag, a reconciled row, money
    // assigned in a month after `now`.
    const firstPlan = text(readZip(first.bytes)[0]?.data as Uint8Array);
    const firstRegister = text(readZip(first.bytes)[1]?.data as Uint8Array);
    expect(firstPlan).toContain(
      '"Oct 2026","Credit Card Payments: Sample Visa","Credit Card Payments","Sample Visa"',
    );
    expect(firstRegister).toContain('"Sample Visa","","10/15/2026","Card Shop"');
    expect(firstRegister).toContain('"Split (1/2) food"');
    expect(firstRegister).toContain('"Split (2/2) "');
    expect(firstRegister).toContain('"Transfer : Rainy Day"');
    expect(firstRegister).toContain('"Transfer : Main Checking"');
    expect(firstRegister).toContain(
      '"Main Checking","","12/01/2026","Landlord","Bills: Rent","Bills","Rent","monthly",$900.00,$0.00,"Uncleared"',
    );
    expect(firstPlan).toContain('"Hidden Categories: Old Hobby"');
    expect(firstPlan).toContain('"Hidden Categories: Hobby"');
    expect(firstRegister).toMatch(
      /"Main Checking","Red","10\/14\/2026","Corner Shop".*"Split \(1\/2\) food"/,
    );
    expect(firstRegister).toMatch(
      /"Main Checking","Red","10\/14\/2026","Corner Shop".*"Split \(2\/2\) "/,
    );
    expect(firstRegister).toMatch(/"Transfer : Rainy Day".*"Reconciled"/);
    expect(firstRegister).toMatch(/"Transfer : Main Checking".*"Reconciled"/);
    expect(firstPlan).toContain(
      '"Dec 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$50.00,$0.00,$180.00',
    );
    const res = await postImport(importForm([{ name: first.name, data: first.bytes }]));
    const data = await body(res, 201);
    expect(data.state).toBe("done");
    // And the new plan's rows in D1 hold them.
    const nb = data.budget_id as string;
    const one = async (sql: string) => ((await q(sql, nb))[0] as Json).n as number;
    const card = (await q(
      "select id from accounts where budget_id = ? and type = 'creditCard'",
      nb,
    )) as Json[];
    expect(card).toHaveLength(1);
    expect(
      await one(
        `select count(*) n from categories where budget_id = ? and kind = 'credit_card_payment' and account_id = '${card[0]?.id}'`,
      ),
    ).toBe(1);
    const parents = (await q(
      "select parent_transaction_id p, count(*) n from transactions where budget_id = ? and parent_transaction_id is not null and deleted_at is null group by 1",
      nb,
    )) as Json[];
    expect(parents.map((r) => r.n)).toEqual([2]);
    expect(
      await one(
        "select count(*) n from transactions where budget_id = ? and transfer_transaction_id is not null",
      ),
    ).toBe(2);
    expect(await one("select count(*) n from scheduled_transactions where budget_id = ?")).toBe(1);
    expect(
      await one("select count(*) n from categories where budget_id = ? and hidden = 1"),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await one("select count(*) n from transactions where budget_id = ? and flag_color = 'red'"),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await one(
        "select count(*) n from transactions where budget_id = ? and cleared = 'reconciled'",
      ),
    ).toBe(2);
    expect(
      await one(
        "select count(*) n from month_categories where budget_id = ? and month = '2026-12-01'",
      ),
    ).toBeGreaterThanOrEqual(1);
    const second = await exportOf(data.budget_id);
    const a = readZip(first.bytes);
    const b = readZip(second.bytes);
    expect(b.map((e) => e.name)).toEqual(a.map((e) => e.name));
    expect(text(b[0]?.data as Uint8Array)).toBe(text(a[0]?.data as Uint8Array));
    expect(text(b[1]?.data as Uint8Array)).toBe(text(a[1]?.data as Uint8Array));
    expect(data.summary.warning_count).toBeGreaterThanOrEqual(0);
  });

  it("gives identical files through the stepped path (chunkRows 7)", async () => {
    importLimits.chunkRows = 7;
    const small = importLimits.singleCallRows;
    importLimits.singleCallRows = 0;
    try {
      const f = await buildF();
      const first = await exportOf(f.bid);
      const res = await postImport(importForm([{ name: first.name, data: first.bytes }]));
      const start = await body(res, 202);
      expect(start.state).toBe("writing");
      expect(start.budget_id).toBeNull();
      expect(start.progress.chunk_count).toBeGreaterThan(3);
      const { data } = await runToDone(start);
      const second = await exportOf(data.budget_id);
      const a = readZip(first.bytes);
      const b = readZip(second.bytes);
      expect(text(b[0]?.data as Uint8Array)).toBe(text(a[0]?.data as Uint8Array));
      expect(text(b[1]?.data as Uint8Array)).toBe(text(a[1]?.data as Uint8Array));
    } finally {
      importLimits.singleCallRows = small;
    }
  });
});

describe("EXF-723: a reconciliation adjustment", () => {
  it("is exported under its own name and survives the round trip", async () => {
    const f = await buildF();
    const acct = (await (
      await json(`/api/v1/budgets/${f.bid}/accounts/${f.accounts.main}`)
    ).json()) as Json;
    const cleared = acct.data.account.cleared_balance as number;
    const rec = await reconcile(f.bid, f.accounts.main, {
      statement_balance: cleared - 5000,
      create_adjustment: true,
      today: "2026-11-16",
    });
    expect(rec.status).toBe(200);
    const first = await exportOf(f.bid);
    const firstRegister = text(readZip(first.bytes)[1]?.data as Uint8Array);
    expect(firstRegister).toMatch(
      /"Main Checking","","11\/16\/2026","Reconciliation Balance Adjustment","Inflow: Ready to Assign".*\$5\.00,\$0\.00,"Reconciled"/,
    );
    const data = await body(
      await postImport(importForm([{ name: first.name, data: first.bytes }])),
      201,
    );
    expect(data.state).toBe("done");
    const nb = data.budget_id as string;
    const payees = (await q(
      "select id, name from payees where budget_id = ? and system = 'reconciliation_adjustment'",
      nb,
    )) as Json[];
    expect(payees).toHaveLength(1);
    expect(payees[0]?.name).toBe("Reconciliation Balance Adjustment");
    const row = (await q(
      "select payee_id from transactions where budget_id = ? and payee_name = 'Reconciliation Balance Adjustment'",
      nb,
    )) as Json[];
    expect(row.map((r) => r.payee_id)).toEqual([payees[0]?.id]);
    const second = await exportOf(nb);
    const a = readZip(first.bytes);
    const b = readZip(second.bytes);
    expect(text(b[0]?.data as Uint8Array)).toBe(text(a[0]?.data as Uint8Array));
    expect(text(b[1]?.data as Uint8Array)).toBe(text(a[1]?.data as Uint8Array));
  });
});

describe("criterion 5: the recomputed Activity and Available", () => {
  it("F exported then imported has no mismatch, and the figures equal the new plan's months", async () => {
    const f = await buildF();
    const first = await exportOf(f.bid);
    const data = await body(
      await postImport(importForm([{ name: first.name, data: first.bytes }])),
      201,
    );
    expect(data.summary.mismatch_count).toBe(0);
    expect(data.summary.mismatches).toEqual([]);
    const plan = text(readZip(first.bytes)[0]?.data as Uint8Array);
    expect(plan).toContain(
      '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$0.00,-$70.00,$130.00',
    );
    const oct = (
      (await (await json(`/api/v1/budgets/${data.budget_id}/months/2026-10-01`)).json()) as Json
    ).data;
    const groceries = oct.groups
      .flatMap((g: Json) => g.categories)
      .find((c: Json) => c.name === "Groceries 🛒");
    expect([groceries.activity, groceries.available]).toEqual([-70000, 130000]);
  });

  it("one edited Activity cell is exactly that mismatch", async () => {
    const f = await buildF();
    const first = await exportOf(f.bid);
    const [planEntry, regEntry] = readZip(first.bytes);
    const planText = text(planEntry?.data as Uint8Array);
    const edited = planText.replace(
      '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$0.00,-$70.00,$130.00',
      '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$0.00,-$71.00,$130.00',
    );
    expect(edited).not.toBe(planText);
    const data = await body(
      await postImport(
        importForm([
          { name: planEntry?.name as string, data: edited },
          { name: regEntry?.name as string, data: regEntry?.data as Uint8Array },
        ]),
      ),
      201,
    );
    expect(data.summary.mismatch_count).toBe(1);
    expect(data.summary.mismatches).toEqual([
      {
        category: "Everyday: Groceries 🛒",
        month: "2026-10-01",
        column: "activity",
        expected: -71000,
        got: -70000,
      },
    ]);
    void env;
    void q;
  });
});
