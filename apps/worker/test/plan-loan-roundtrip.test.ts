import { describe, expect, it } from "vitest";
import { type Json, plan, q } from "./bulk-helpers";
import { json } from "./helpers";
import { NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";
import { body, importForm, postImport } from "./plan-import-helpers";

// EXF-991: the loan account fields (interest rate, payment, escrow, paired category) go through Export Plan and
// Import Plan. Design: docs/plan-export-design.md and docs/plan-import-design.md, "Loan accounts".
pinPlanClock();

const base = (bid: string) => `/api/v1/budgets/${bid}/accounts`;
const rand = () => crypto.randomUUID().slice(0, 8);

async function loan(bid: string, extra: Json) {
  const res = await json(
    base(bid),
    { method: "POST" },
    {
      balance: 180000000,
      interest_rate: "6.5",
      minimum_payment: 1400000,
      date: "2026-11-10",
      ...extra,
    },
  );
  expect(res.status, await res.clone().text()).toBe(201);
}

async function exportOf(bid: string) {
  const res = await json(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`);
  expect(res.status).toBe(200);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
}

const loanRows = (bid: string) =>
  q(
    `select a.name, a.type, a.interest_rate, a.minimum_payment, a.escrow_amount, a.paired_category_id,
            c.name cat, g.name grp
       from accounts a
       left join categories c on c.id = a.paired_category_id
       left join category_groups g on g.id = c.group_id
      where a.budget_id = ? order by a.name`,
    bid,
  ) as Promise<Json[]>;

async function twoLoans() {
  const bid = await plan();
  const tag = rand();
  await loan(bid, {
    name: `ZZ Mortgage ${tag}`,
    type: "mortgage",
    escrow_amount: 350000,
    new_category: { name: "Mortgage Pmt", new_group_name: "Housing Loans" },
  });
  await loan(bid, {
    name: `ZZ Auto ${tag}`,
    type: "autoLoan",
    interest_rate: "4.25",
    minimum_payment: 420000,
    balance: 20000000,
  });
  await json(
    base(bid),
    { method: "POST" },
    {
      name: `ZZ Checking ${tag}`,
      type: "checking",
      balance: 500000,
      date: "2026-11-10",
    },
  );
  return bid;
}

describe("EXF-991 loan fields in the export and import", () => {
  it("a round trip keeps rate, payment, escrow and the pairing", async () => {
    const bid = await twoLoans();
    const first = await exportOf(bid);
    const res = await postImport(
      importForm([{ name: first.name, data: first.bytes }], { date_format: "MM/DD/YYYY" }),
    );
    const data = await body(res, 201);
    const got = await loanRows(data.budget_id);
    const loans = got.filter((r) => r.type === "mortgage" || r.type === "autoLoan");
    expect(loans).toHaveLength(2);
    const m = loans.find((r) => r.type === "mortgage") as Json;
    expect(m).toMatchObject({
      interest_rate: "6.5",
      minimum_payment: 1400000,
      escrow_amount: 350000,
      grp: "Housing Loans",
      cat: "Mortgage Pmt",
    });
    // The pairing is the NEW plan's category, not the source's.
    const src = await loanRows(bid);
    expect(m.paired_category_id).toBeTruthy();
    expect(src.find((r) => r.type === "mortgage")?.paired_category_id).not.toBe(
      m.paired_category_id,
    );
    const a = loans.find((r) => r.type === "autoLoan") as Json;
    expect(a).toMatchObject({
      interest_rate: "4.25",
      minimum_payment: 420000,
      escrow_amount: 0,
      paired_category_id: null,
    });
    const other = got.find((r) => r.type === "checking") as Json;
    expect(other).toMatchObject({
      interest_rate: null,
      minimum_payment: null,
      escrow_amount: null,
      paired_category_id: null,
    });
    // Exporting the imported plan again gives the same Register.
    const second = await exportOf(data.budget_id);
    const reg = (b: Uint8Array) => text(readZip(b)[1]?.data as Uint8Array);
    expect(reg(second.bytes)).toBe(reg(first.bytes));
  });

  it("an older export without the loan columns imports with the fields null", async () => {
    const bid = await twoLoans();
    const first = await exportOf(bid);
    const entries = readZip(first.bytes);
    const strip = (s: string) =>
      s
        .split("\r\n")
        .map((l) => {
          const cells = l.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? [];
          return cells.slice(0, 11).join("").replace(/,$/, "");
        })
        .join("\r\n");
    const plan_ = text(entries[0]?.data as Uint8Array);
    const old = strip(text(entries[1]?.data as Uint8Array));
    expect(old.split("\r\n")[0]).toMatch(/"Cleared"$/);
    const res = await postImport(
      importForm(
        [
          { name: "Budget Export - Old as of 2026-11-16 09-05 - Plan.csv", data: plan_ },
          { name: "Budget Export - Old as of 2026-11-16 09-05 - Register.csv", data: old },
        ],
        { date_format: "MM/DD/YYYY" },
      ),
    );
    const data = await body(res, 201);
    for (const r of await loanRows(data.budget_id)) {
      expect(r).toMatchObject({
        interest_rate: null,
        minimum_payment: null,
        escrow_amount: null,
        paired_category_id: null,
      });
    }
  });

  it("a pairing the new plan cannot find becomes null, with a warning", async () => {
    const bid = await twoLoans();
    const first = await exportOf(bid);
    const entries = readZip(first.bytes);
    const plan_ = text(entries[0]?.data as Uint8Array);
    const reg = text(entries[1]?.data as Uint8Array).replaceAll('"Mortgage Pmt"', '"Gone"');
    const res = await postImport(
      importForm(
        [
          { name: "Budget Export - P as of 2026-11-16 09-05 - Plan.csv", data: plan_ },
          { name: "Budget Export - P as of 2026-11-16 09-05 - Register.csv", data: reg },
        ],
        { date_format: "MM/DD/YYYY" },
      ),
    );
    const data = await body(res, 201);
    const m = (await loanRows(data.budget_id)).find((r) => r.type === "mortgage") as Json;
    expect(m.paired_category_id).toBeNull();
    expect(m.minimum_payment).toBe(1400000);
    expect(data.summary.warnings.map((w: Json) => w.code)).toContain("loan_pairing_not_found");
  });
});
