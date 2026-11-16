import { describe, expect, it } from "vitest";
import {
  breakdownCsv,
  centsRound,
  computeBreakdown,
  daysInMonth,
  filterRows,
  newestFirst,
  rangeDays,
  type SpendingRow,
  sharePct,
  transactionsCsv,
} from "../src/spending-breakdown";

let n = 0;
interface Cat {
  id: string;
  name: string;
  order: number;
  hidden?: boolean;
}
const GROUP = { id: "g1", name: "D8 Group", order: 1 };
const FOOD: Cat = { id: "c-food", name: "D8 Food", order: 1 };
const FUN: Cat = { id: "c-fun", name: "D8 Fun", order: 2 };
const UTIL: Cat = { id: "c-util", name: "D8 Utilities", order: 3 };
const LOAN: Cat = { id: "c-loan", name: "D8 Loan Pmt", order: 4 };
const HIDDEN: Cat = { id: "c-hid", name: "D8 Hidden", order: 5, hidden: true };

function row(
  date: string,
  cat: Cat | null,
  amount: number,
  o: Partial<SpendingRow> = {},
): SpendingRow {
  n += 1;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    transaction_id: `t${String(n).padStart(3, "0")}`,
    subtransaction_id: null,
    account_id: "a-check",
    account_name: "D8 Checking",
    date,
    created_at: `2026-11-01T00:00:${String(n).padStart(2, "0")}Z`,
    split_index: null,
    amount,
    payee_name: null,
    memo: null,
    cleared: "uncleared",
    category_id: cat?.id ?? null,
    category_name: cat?.name ?? null,
    category_hidden: cat?.hidden ?? false,
    category_order: cat?.order ?? 0,
    group_id: cat ? GROUP.id : null,
    group_name: cat ? GROUP.name : null,
    group_hidden: false,
    group_order: cat ? GROUP.order : 0,
    ...o,
  };
}

// The counted rows of the ticket's example: no Ready to Assign, no Starting Balance, no transfer between on-plan accounts.
const EXAMPLE: SpendingRow[] = [
  row("2026-07-10", FOOD, -120000, { payee_name: "D8 Grocer", memo: "weekly shop" }),
  row("2026-07-22", FUN, -45000, { payee_name: "D8 Cinema" }),
  row("2026-08-05", FOOD, -80500, { payee_name: "D8 Grocer" }),
  row("2026-08-20", FUN, -25000, { payee_name: "D8 Cinema" }),
  row("2026-09-03", UTIL, -60250, { payee_name: "D8 Power Co" }),
  row("2026-09-12", FOOD, -99990, { payee_name: "D8 Grocer" }),
  row("2026-09-20", null, -15000, { payee_name: "D8 Mystery" }),
  row("2026-10-01", LOAN, -250000, { payee_name: "Transfer : D8 Car Loan" }),
  row("2026-10-07", FUN, -30000, { payee_name: "D8 Cinema" }),
  row("2026-10-09", FOOD, -150000, { payee_name: "D8 Grocer" }),
  row("2026-10-21", FOOD, 20000, { payee_name: "D8 Grocer", memo: "refund" }),
  row("2026-10-25", HIDDEN, -40000, { payee_name: "D8 Gift Shop", category_hidden: true }),
  row("2026-11-03", FOOD, -55000, { payee_name: "D8 Grocer" }),
];

const span = (a: string, b: string) => ({ start_month: `${a}-01`, end_month: `${b}-01` });
const inSpan = (rows: SpendingRow[], s: { start_month: string; end_month: string }) =>
  rows.filter(
    (r) => `${r.date.slice(0, 7)}-01` >= s.start_month && `${r.date.slice(0, 7)}-01` <= s.end_month,
  );
const run = (
  a: string,
  b: string,
  groupBy: "category" | "group" = "category",
  group = null as null | { id: string; name: string },
) => {
  const s = span(a, b);
  return computeBreakdown({ rows: inSpan(EXAMPLE, s), span: s, groupBy, group });
};

describe("ticket figures (today 2026-11-15)", () => {
  it("Jun–Nov", () => {
    const r = run("2026-06", "2026-11");
    expect(r.total).toBe(950740);
    expect(r.months).toBe(6);
    expect(r.days).toBe(183);
    expect(r.items.map((i) => [i.name, i.total, i.share_pct])).toEqual([
      ["D8 Food", 485490, 51],
      ["D8 Loan Pmt", 250000, 26],
      ["D8 Fun", 100000, 11],
      ["D8 Utilities", 60250, 6],
      ["D8 Hidden", 40000, 4],
      ["Uncategorized", 15000, 2],
    ]);
    expect(r.items[0]?.group_name).toBe("D8 Group");
    expect(r.items[5]?.group_name).toBeNull();
    expect(r.average_monthly).toBe(158460);
    expect(r.average_daily).toBe(5200);
    expect(r.most_frequent).toEqual({ id: FOOD.id, name: "D8 Food", transaction_count: 6 });
    expect(r.largest_outflow).toMatchObject({
      payee_name: "Transfer : D8 Car Loan",
      amount: 250000,
    });
  });
  it("May–Nov, Sep–Nov and Nov", () => {
    const may = run("2026-05", "2026-11");
    expect([may.total, may.average_monthly, may.average_daily, may.days]).toEqual([
      950740, 135820, 4440, 214,
    ]);
    const sep = run("2026-09", "2026-11");
    expect([sep.total, sep.average_monthly, sep.average_daily, sep.days]).toEqual([
      680240, 226750, 7480, 91,
    ]);
    const nov = run("2026-11", "2026-11");
    expect([nov.total, nov.average_monthly, nov.average_daily, nov.days]).toEqual([
      55000, 55000, 1830, 30,
    ]);
  });
  it("Groups mode", () => {
    const r = run("2026-06", "2026-11", "group");
    expect(r.items.map((i) => [i.name, i.total, i.share_pct, i.group_name])).toEqual([
      ["D8 Group", 935740, 98, null],
      ["Uncategorized", 15000, 2, null],
    ]);
    expect(r.most_frequent).toEqual({ id: GROUP.id, name: "D8 Group", transaction_count: 12 });
  });
  it("the group drill", () => {
    const r = run("2026-06", "2026-11", "group", { id: GROUP.id, name: GROUP.name });
    expect(r.group_by).toBe("category");
    expect(r.total).toBe(935740);
    expect(r.items.find((i) => i.name === "D8 Food")?.share_pct).toBe(52);
    expect(r.items.find((i) => i.name === "D8 Loan Pmt")?.share_pct).toBe(27);
    expect(r.items.some((i) => i.name === "Uncategorized")).toBe(false);
    expect(r.average_monthly).toBe(155960);
    expect(r.average_daily).toBe(5110);
  });
  it("filters by category and account", () => {
    const rows = filterRows(EXAMPLE, {
      excludedCategoryIds: ["uncategorized"],
      excludedAccountIds: [],
    });
    expect(rows.some((r) => r.category_id === null)).toBe(false);
    expect(
      filterRows(EXAMPLE, { excludedCategoryIds: [], excludedAccountIds: ["a-check"] }),
    ).toEqual([]);
    expect(
      filterRows(EXAMPLE, { excludedCategoryIds: [FOOD.id], excludedAccountIds: [] }),
    ).toHaveLength(7);
  });
});

describe("CSV", () => {
  const s = span("2026-06", "2026-11");
  const summary = breakdownCsv(EXAMPLE, s);
  it("summary rows, BOM, LF, no trailing newline", () => {
    expect(summary.startsWith("﻿")).toBe(true);
    expect(summary).not.toContain("\r");
    expect(summary.endsWith("\n")).toBe(false);
    const lines = summary.slice(1).split("\n");
    expect(lines[0]).toBe(
      '"Category Group","Category","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026","Average","Total"',
    );
    expect(lines).toContain(
      '"D8 Group","D8 Food",0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-80.92,-485.49',
    );
    expect(lines[lines.length - 1]).toBe(
      '"","Uncategorized",0.00,0.00,0.00,-15.00,0.00,0.00,-2.50,-15.00',
    );
    // hidden categories follow the visible ones, before Uncategorized
    expect(lines[lines.length - 2]).toBe(
      '"Hidden Categories","D8 Hidden",0.00,0.00,0.00,0.00,-40.00,0.00,-6.67,-40.00',
    );
  });
  it("transactions CSV", () => {
    const csv = transactionsCsv(EXAMPLE);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).not.toContain("\r");
    expect(csv.endsWith("\n")).toBe(false);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe(
      '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
    );
    expect(lines).toHaveLength(14);
    expect(lines[1]).toBe(
      '"D8 Checking","","11/03/2026","D8 Grocer","D8 Group: D8 Food","D8 Group","D8 Food","",$55.00,$0.00,"Uncleared"',
    );
    expect(lines).toContain(
      '"D8 Checking","","10/01/2026","Transfer : D8 Car Loan","D8 Group: D8 Loan Pmt","D8 Group","D8 Loan Pmt","",$250.00,$0.00,"Uncleared"',
    );
    expect(lines).toContain(
      '"D8 Checking","","10/21/2026","D8 Grocer","D8 Group: D8 Food","D8 Group","D8 Food","refund",$0.00,$20.00,"Uncleared"',
    );
    expect(
      lines.some((l) =>
        l.includes('"Hidden Categories: D8 Hidden","Hidden Categories","D8 Hidden"'),
      ),
    ).toBe(true);
    expect(lines.find((l) => l.includes("D8 Mystery"))).toContain('"D8 Mystery","","","","",');
  });
  it("cleared and reconciled read Cleared; amounts carry no thousands separator", () => {
    const csv = transactionsCsv([row("2026-11-01", FOOD, -1234500, { cleared: "reconciled" })]);
    expect(csv).toContain(',$1234.50,$0.00,"Cleared"');
  });
});

describe("split case S", () => {
  // Lines as rows, parents absent (the SQL leaves them out).
  const s = span("2026-11", "2026-11");
  const SFOOD: Cat = { id: "s-food", name: "S Food", order: 1 };
  const SFUN: Cat = { id: "s-fun", name: "S Fun", order: 2 };
  const sg = { group_id: "sg", group_name: "S Group", group_order: 1 };
  const line = (date: string, cat: Cat | null, amount: number, o: Partial<SpendingRow>) =>
    row(date, cat, amount, { ...(cat ? sg : {}), ...o });
  const rows = [
    line("2026-11-04", SFOOD, -60000, {
      transaction_id: "A",
      subtransaction_id: "A1",
      split_index: 0,
      payee_name: "S Market",
    }),
    line("2026-11-04", SFUN, -40000, {
      transaction_id: "A",
      subtransaction_id: "A2",
      split_index: 1,
      payee_name: "S Market",
    }),
    line("2026-11-06", SFOOD, -20000, {
      transaction_id: "B",
      subtransaction_id: "B1",
      split_index: 0,
      payee_name: "S Shop",
      memo: "line memo",
    }),
    line("2026-11-06", null, -10000, {
      transaction_id: "B",
      subtransaction_id: "B2",
      split_index: 1,
      payee_name: "S Line Payee",
    }),
    line("2026-11-08", SFOOD, -15000, { payee_name: "S Shop" }),
    line("2026-11-09", null, -55000, { payee_name: "Transfer : S Loan" }),
  ];
  it("counts each line once", () => {
    const r = computeBreakdown({ rows, span: s, groupBy: "category", group: null });
    expect(r.total).toBe(200000);
    expect(r.items.map((i) => [i.name, i.total, i.share_pct])).toEqual([
      ["S Food", 95000, 48],
      ["Uncategorized", 65000, 33],
      ["S Fun", 40000, 20],
    ]);
    expect(r.most_frequent).toMatchObject({ name: "S Food", transaction_count: 3 });
    expect(r.largest_outflow).toEqual({
      transaction_id: "A",
      payee_name: "S Market",
      amount: 60000,
    });
  });
});

describe("ties and empties", () => {
  const s = span("2026-11", "2026-11");
  it("ranks ties by plan order, most frequent ties by total", () => {
    const rows = [
      row("2026-11-01", FUN, -10000),
      row("2026-11-02", FOOD, -10000),
      row("2026-11-03", null, -10000),
    ];
    const r = computeBreakdown({ rows, span: s, groupBy: "category", group: null });
    expect(r.items.map((i) => i.name)).toEqual(["D8 Food", "D8 Fun", "Uncategorized"]);
    expect(r.most_frequent?.name).toBe("D8 Food");
    const r2 = computeBreakdown({
      rows: [
        row("2026-11-01", FUN, -10000),
        row("2026-11-02", FOOD, -20000),
        row("2026-11-03", FOOD, 5000),
        row("2026-11-04", FUN, -1),
      ],
      span: s,
      groupBy: "category",
      group: null,
    });
    expect(r2.most_frequent?.transaction_count).toBe(2);
  });
  it("an all-inflow category is not listed", () => {
    const r = computeBreakdown({
      rows: [row("2026-11-01", FOOD, 5000)],
      span: s,
      groupBy: "category",
      group: null,
    });
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.most_frequent).toBeNull();
    expect(r.largest_outflow).toBeNull();
  });
  it("empty input", () => {
    const r = computeBreakdown({ rows: [], span: s, groupBy: "category", group: null });
    expect([
      r.total,
      r.average_monthly,
      r.average_daily,
      r.items,
      r.most_frequent,
      r.largest_outflow,
    ]).toEqual([0, 0, 0, [], null, null]);
    expect(Object.is(r.average_monthly, 0)).toBe(true);
  });
  it("newest first", () => {
    const a = row("2026-11-01", FOOD, -1);
    const b = row("2026-11-02", FOOD, -1);
    expect([a, b].sort(newestFirst)[0]).toBe(b);
  });
});

describe("arithmetic helpers", () => {
  it("days", () => {
    expect(daysInMonth("2028-02-01")).toBe(29);
    expect(rangeDays(span("2026-12", "2027-01"))).toBe(62);
    expect(rangeDays(span("2026-02", "2026-02"))).toBe(28);
  });
  it("rounding", () => {
    expect(centsRound(950740, 6)).toBe(158460);
    expect(centsRound(-485490, 6)).toBe(-80920);
    expect(centsRound(-1, 6)).toBe(0);
    expect(sharePct(5, 10)).toBe(50);
    expect(sharePct(1, 0)).toBe(0);
    expect(sharePct(5, 1000)).toBe(1);
  });
});
