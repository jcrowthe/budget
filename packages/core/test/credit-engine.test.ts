import { describe, expect, it } from "vitest";
import type { AccountType } from "../src/account-types";
import { accountGroup } from "../src/account-types";
import {
  classifyTransaction,
  computeMonth,
  type EngineActivity,
  type EngineInput,
  type MonthDetail,
  splitAcrossCards,
  splitOverspending,
} from "../src/budget-engine";

// EXF-532, EXF-535. A small world of accounts and rows is turned into the engine's input the way the Worker's
// read does it: the cash side of a transfer between two on-plan accounts is dropped, the card side is kept.

const NOV = "2026-11-01";
const DEC = "2026-12-01";

interface Acct {
  id: string;
  type: AccountType;
}
interface Row {
  date: string;
  account: string;
  amount: number;
  category?: string | null;
  inflow?: boolean;
  /** The other account of a transfer. A pair of rows is made by `transfer()`. */
  peer?: string;
}

const onBudget = (t: AccountType) => t !== "otherAsset";

function toActivity(accounts: Acct[], rows: Row[]): EngineActivity[] {
  const by = new Map(accounts.map((a) => [a.id, a]));
  const out: EngineActivity[] = [];
  for (const r of rows) {
    const a = by.get(r.account) as Acct;
    const peer = r.peer ? by.get(r.peer) : undefined;
    const xfer = !!peer && onBudget(a.type) && onBudget(peer.type);
    const card = accountGroup(a.type) === "credit";
    if (xfer && !card) continue;
    out.push({
      date: r.date,
      amount: r.amount,
      categoryId: xfer ? null : (r.category ?? null),
      inflowToReadyToAssign: r.inflow ?? false,
      onBudget: onBudget(a.type),
      accountType: a.type,
      accountId: card ? a.id : null,
      transfer: xfer,
    });
  }
  return out;
}

const transfer = (date: string, from: string, to: string, amount: number): Row[] => [
  { date, account: from, amount: -amount, peer: to },
  { date, account: to, amount, peer: from },
];

function input(
  accounts: Acct[],
  rows: Row[],
  assigned: Record<string, Record<string, number>>,
  categories: { id: string; accountId?: string; group?: string }[],
): EngineInput {
  return {
    groups: [
      { id: "g", name: "Bills", sortOrder: 0, hidden: false, collapsed: false },
      {
        id: "pay",
        name: "Credit Card Payments",
        sortOrder: -1,
        hidden: false,
        collapsed: false,
        kind: "credit_card_payments",
      },
    ],
    categories: categories.map((c, i) => ({
      id: c.id,
      groupId: c.accountId ? "pay" : "g",
      name: c.id,
      sortOrder: i,
      hidden: false,
      kind: c.accountId ? ("credit_card_payment" as const) : null,
      accountId: c.accountId ?? null,
    })),
    assignments: Object.entries(assigned).flatMap(([month, byCat]) =>
      Object.entries(byCat).map(([categoryId, a]) => ({ categoryId, month, assigned: a })),
    ),
    activity: toActivity(accounts, rows),
    notes: [],
  };
}

const cat = (d: MonthDetail, id: string) =>
  d.groups
    .flatMap((g) => g.categories)
    .find((c) => c.id === id) as MonthDetail["groups"][0]["categories"][0];

describe("splitOverspending (EXF-535 rule 2)", () => {
  it("is null while available is not negative", () => {
    expect(splitOverspending(0, -50000)).toBeNull();
    expect(splitOverspending(10, -50000)).toBeNull();
  });
  it("credit part is min(-available, credit spending); cash is the rest", () => {
    expect(splitOverspending(-30000, -80000)).toEqual({ cash: 0, credit: 30000 });
    expect(splitOverspending(-25000, 0)).toEqual({ cash: 25000, credit: 0 });
    expect(splitOverspending(-65000, -40000)).toEqual({ cash: 25000, credit: 40000 });
  });
  it("a net refund gives no credit part", () => {
    expect(splitOverspending(-10000, 5000)).toEqual({ cash: 10000, credit: 0 });
  });
});

describe("splitAcrossCards (Lead's note 2)", () => {
  const spend = (o: Record<string, number>) => new Map(Object.entries(o));
  it("is proportional", () => {
    expect([...splitAcrossCards(40000, spend({ a: 30000, b: 10000 }))]).toEqual([
      ["a", 30000],
      ["b", 10000],
    ]);
  });
  it("hands the remainder out by largest remainder, to whole milliunits that sum exactly", () => {
    // 10001 * 3/4 = 7500.75 -> 7500 r .75 ; 10001 * 1/4 = 2500.25 -> 2500 r .25 ; one left over goes to a
    const r = splitAcrossCards(10001, spend({ a: 30000, b: 10000 }));
    expect(r.get("a")).toBe(7501);
    expect(r.get("b")).toBe(2500);
    const q = splitAcrossCards(10001 - 2, spend({ a: 30000, b: 10000 }));
    expect([...q.values()].reduce((x, y) => x + y, 0)).toBe(9999);
  });
  it("ties go to the lower account id", () => {
    const r = splitAcrossCards(1, spend({ b: 10000, a: 10000 }));
    expect(r.get("a")).toBe(1);
    expect(r.get("b")).toBe(0);
  });
  it("a card at zero or less takes none", () => {
    const r = splitAcrossCards(25000, spend({ a: 30000, b: -5000, c: 0 }));
    expect(r.get("a")).toBe(25000);
    expect(r.has("b")).toBe(false);
    expect(r.has("c")).toBe(false);
  });
});

describe("classifyTransaction (credit rules)", () => {
  const base: EngineActivity = {
    date: "2026-11-05",
    amount: -1000,
    categoryId: "c",
    inflowToReadyToAssign: false,
    onBudget: true,
    accountType: "creditCard",
    accountId: "k",
  };
  const ids = new Set(["c", "p"]);
  const pay = new Set(["p"]);
  it("a card row in an ordinary category is credit spending of (category, card)", () => {
    expect(classifyTransaction(base, ids, pay)).toEqual({
      kind: "credit",
      categoryId: "c",
      accountId: "k",
    });
  });
  it("a row into a payment category, cash or card, is that category's activity", () => {
    expect(classifyTransaction({ ...base, categoryId: "p" }, ids, pay)).toEqual({
      kind: "category",
      categoryId: "p",
    });
    expect(
      classifyTransaction(
        { ...base, categoryId: "p", accountType: "checking", accountId: null },
        ids,
        pay,
      ),
    ).toEqual({ kind: "category", categoryId: "p" });
  });
  it("an uncategorized card row stays uncategorized; a card inflow is Ready to Assign", () => {
    expect(classifyTransaction({ ...base, categoryId: null }, ids, pay)).toEqual({
      kind: "uncategorized",
    });
    expect(
      classifyTransaction({ ...base, categoryId: null, inflowToReadyToAssign: true }, ids, pay),
    ).toEqual({
      kind: "rta_inflow",
    });
  });
  it("a transfer counts on the card side only", () => {
    expect(classifyTransaction({ ...base, categoryId: null, transfer: true }, ids, pay)).toEqual({
      kind: "card_transfer",
      accountId: "k",
    });
    expect(
      classifyTransaction(
        { ...base, categoryId: null, transfer: true, accountType: "checking", accountId: null },
        ids,
        pay,
      ),
    ).toEqual({ kind: "ignored" });
  });
});

// ---- EXF-535's worked example, replayed through the engine ----

const ACCTS: Acct[] = [
  { id: "check", type: "checking" },
  { id: "visa", type: "creditCard" },
];
const CATS = [
  { id: "groceries" },
  { id: "dining" },
  { id: "empty" },
  { id: "mixed" },
  { id: "order" },
  { id: "visa-pay", accountId: "visa" },
];
const ASSIGNED = { groceries: 300000, dining: 50000, empty: 0, mixed: 50000, order: 50000 };
const D = "2026-11-10";
const visa = (amount: number, category: string, date = D): Row => ({
  date,
  account: "visa",
  amount,
  category,
});
const check = (amount: number, category: string, date = D): Row => ({
  date,
  account: "check",
  amount,
  category,
});
const funding: Row = { date: "2026-11-02", account: "check", amount: 1000000, inflow: true };

const STEPS: Row[][] = [
  [visa(-120000, "groceries")],
  [visa(-80000, "dining")],
  [check(-25000, "empty")],
  [visa(-40000, "empty")],
  [check(-30000, "mixed"), visa(-40000, "mixed")],
  [visa(-40000, "order", "2026-11-10"), check(-30000, "order", "2026-11-12")],
];

function replay(
  n: number,
  extra: Row[] = [],
  assigned = ASSIGNED,
  extraAssigned: Record<string, number> = {},
) {
  const rows = [funding, ...STEPS.slice(0, n).flat(), ...extra];
  return input(ACCTS, rows, { [NOV]: { ...assigned, ...extraAssigned } }, CATS);
}

describe("EXF-535 steps 1-11", () => {
  const payment = [120000, 170000, 170000, 170000, 190000, 210000];
  it("steps 1-6: payment activity after each step", () => {
    payment.forEach((expected, i) => {
      expect(cat(computeMonth(replay(i + 1), NOV), "visa-pay").activity).toBe(expected);
    });
  });
  it("step 1-6 categories: yellow, red, mixed", () => {
    const d = computeMonth(replay(6), NOV);
    expect(cat(d, "groceries").available).toBe(180000);
    expect(cat(d, "dining")).toMatchObject({
      available: -30000,
      state: "credit_overspent",
      overspent: { cash: 0, credit: 30000 },
    });
    expect(cat(d, "empty")).toMatchObject({
      available: -65000,
      state: "cash_overspent",
      overspent: { cash: 25000, credit: 40000 },
      cash_spending: -25000,
      credit_spending: -40000,
    });
    expect(cat(d, "mixed")).toMatchObject({
      available: -20000,
      state: "credit_overspent",
      overspent: { cash: 0, credit: 20000 },
    });
    expect(cat(d, "order")).toMatchObject({
      available: -20000,
      state: "credit_overspent",
      overspent: { cash: 0, credit: 20000 },
    });
    expect(cat(d, "visa-pay").available).toBe(210000);
  });
  it("steps 5 and 6 give the same result whatever the order and dates", () => {
    const d = computeMonth(replay(6), NOV);
    const a = cat(d, "mixed");
    const b = cat(d, "order");
    expect({ ...a, id: "", name: "" }).toMatchObject({
      available: b.available,
      overspent: b.overspent,
      state: b.state,
    });
  });
  it("December after step 6: overspent categories start at 0, Groceries carries, the card stays funded", () => {
    const d = computeMonth(replay(6), DEC);
    for (const id of ["dining", "empty", "mixed", "order"]) {
      expect(cat(d, id).available).toBe(0);
      expect(cat(d, id).state).toBe("ok");
    }
    expect(cat(d, "groceries").available).toBe(180000);
    expect(cat(d, "visa-pay").available).toBe(210000);
  });
  it("steps 7-8: cash overspending reaches December's Ready to Assign, credit overspending does not", () => {
    const before = computeMonth(replay(6), DEC).ready_to_assign;
    const nov6 = computeMonth(replay(6), NOV).ready_to_assign;
    const s7 = replay(6, [check(-10000, "empty")]);
    expect(cat(computeMonth(s7, NOV), "empty")).toMatchObject({
      available: -75000,
      overspent: { cash: 35000, credit: 40000 },
    });
    expect(computeMonth(s7, NOV).ready_to_assign).toBe(nov6);
    expect(computeMonth(s7, DEC).ready_to_assign).toBe(before - 10000);
    expect(computeMonth(s7, DEC).rta_breakdown.cash_overspending_previous).toBe(-35000);
    const s8 = replay(6, [check(-10000, "empty"), visa(-10000, "dining"), visa(-5000, "dining")]);
    expect(cat(computeMonth(s8, NOV), "dining")).toMatchObject({
      available: -45000,
      state: "credit_overspent",
    });
    expect(computeMonth(s8, DEC).ready_to_assign).toBe(before - 10000);
    expect(cat(computeMonth(s8, NOV), "visa-pay").activity).toBe(210000);
  });
  const s8rows = [check(-10000, "empty"), visa(-10000, "dining"), visa(-5000, "dining")];
  it("step 9: covering Dining from Groceries moves 45.00 into the payment category", () => {
    const d = computeMonth(replay(6, s8rows, ASSIGNED, { groceries: 255000, dining: 95000 }), NOV);
    expect(cat(d, "groceries")).toMatchObject({ assigned: 255000, available: 135000 });
    expect(cat(d, "dining")).toMatchObject({ assigned: 95000, available: 0, state: "ok" });
    expect(cat(d, "visa-pay").activity).toBe(255000);
  });
  it("step 10: assigning 75.00 to Empty covers the credit part (+40.00)", () => {
    const d = computeMonth(
      replay(6, s8rows, ASSIGNED, { groceries: 255000, dining: 95000, empty: 75000 }),
      NOV,
    );
    expect(cat(d, "empty")).toMatchObject({ available: 0, state: "ok", overspent: null });
    expect(cat(d, "visa-pay").activity).toBe(295000);
  });
  it("step 11: Order and Mixed to 70.00 each; the payment category holds the full balance", () => {
    const assigned = { groceries: 255000, dining: 95000, empty: 75000, order: 70000, mixed: 70000 };
    const d = computeMonth(replay(6, s8rows, ASSIGNED, assigned), NOV);
    for (const id of ["empty", "order", "mixed", "dining"])
      expect(cat(d, id)).toMatchObject({ available: 0, state: "ok" });
    expect(cat(d, "visa-pay").activity).toBe(335000);
    const balance = [...STEPS.flat(), ...s8rows]
      .filter((r) => r.account === "visa")
      .reduce((n, r) => n + r.amount, 0);
    expect(balance).toBe(-335000);
  });
  it("covering only the cash part leaves the payment category alone", () => {
    const assigned = { groceries: 255000, dining: 95000, empty: 35000 };
    const d = computeMonth(replay(6, s8rows, ASSIGNED, assigned), NOV);
    // Empty: -75 + 35 = -40 -> cash 0? credit spending 40 holds the credit part at 40, so the cash part fell first.
    expect(cat(d, "empty")).toMatchObject({
      available: -40000,
      overspent: { cash: 0, credit: 40000 },
    });
    expect(cat(d, "visa-pay").activity).toBe(255000);
  });
});

describe("EXF-532 example A (after step 11)", () => {
  const assigned = { groceries: 255000, dining: 95000, empty: 75000, order: 70000, mixed: 70000 };
  const rowsA = [check(-10000, "empty"), visa(-10000, "dining"), visa(-5000, "dining")];
  const pay = (n: number, date = "2026-11-20"): Row[] => transfer(date, "check", "visa", n);
  const world = (extra: Row[]) => replay(6, [...rowsA, ...extra], ASSIGNED, assigned);
  it("pay 200.00, then 185.00 more", () => {
    const one = computeMonth(world(pay(200000)), NOV);
    expect(cat(one, "visa-pay")).toMatchObject({ activity: 135000, available: 135000 });
    const two = computeMonth(world([...pay(200000), ...pay(185000, "2026-11-21")]), NOV);
    expect(cat(two, "visa-pay")).toMatchObject({
      activity: -50000,
      available: -50000,
      state: "cash_overspent",
    });
    const dec = computeMonth(world([...pay(200000), ...pay(185000, "2026-11-21")]), DEC);
    expect(cat(dec, "visa-pay").available).toBe(0);
    const decOne = computeMonth(world(pay(200000)), DEC);
    expect(decOne.ready_to_assign - dec.ready_to_assign).toBe(50000);
    expect(dec.rta_breakdown.cash_overspending_previous).toBe(
      decOne.rta_breakdown.cash_overspending_previous - 50000,
    );
  });
});

describe("EXF-532 example B (Line of Credit)", () => {
  const accts: Acct[] = [
    { id: "check", type: "checking" },
    { id: "loc", type: "lineOfCredit" },
  ];
  const cats = [{ id: "groceries" }, { id: "loc-pay", accountId: "loc" }];
  const w = (rows: Row[]) =>
    input(accts, [funding, ...rows], { [NOV]: { groceries: 300000 } }, cats);
  const loc = (amount: number, category: string | null, inflow = false): Row => ({
    date: D,
    account: "loc",
    amount,
    category,
    inflow,
  });
  it("walks the four steps", () => {
    let d = computeMonth(w([loc(-100000, "groceries")]), NOV);
    expect(cat(d, "loc-pay")).toMatchObject({ activity: 100000, available: 100000 });
    d = computeMonth(w([loc(-100000, "groceries"), loc(30000, "groceries")]), NOV);
    expect(cat(d, "groceries").credit_spending).toBe(-70000);
    expect(cat(d, "loc-pay")).toMatchObject({ activity: 70000, available: 70000 });
    const base = d.ready_to_assign;
    d = computeMonth(
      w([loc(-100000, "groceries"), loc(30000, "groceries"), loc(15000, null, true)]),
      NOV,
    );
    expect(d.ready_to_assign).toBe(base + 15000);
    expect(cat(d, "loc-pay").available).toBe(70000);
    d = computeMonth(
      w([
        loc(-100000, "groceries"),
        loc(30000, "groceries"),
        loc(15000, null, true),
        loc(777770, null, true),
      ]),
      NOV,
    );
    expect(d.ready_to_assign).toBe(base + 15000 + 777770);
    expect(cat(d, "loc-pay").available).toBe(70000);
  });
});

describe("EXF-532 example C (Debt Card)", () => {
  const accts: Acct[] = [
    { id: "check", type: "checking" },
    { id: "dc", type: "creditCard" },
  ];
  const cats = [{ id: "interest" }, { id: "dc-pay", accountId: "dc" }];
  const w = (rows: Row[], assigned: Record<string, number>) =>
    input(accts, [funding, ...rows], { [NOV]: assigned }, cats);
  it("a starting balance counts nowhere (the read drops it): payment 0, underfunded by the debt", () => {
    const d = computeMonth(w([], {}), NOV);
    expect(cat(d, "dc-pay")).toMatchObject({ assigned: 0, activity: 0, available: 0 });
    expect(d.ready_to_assign).toBe(1000000);
  });
  it("assign 100, pay 100, then a 12.00 card purchase in a funded category", () => {
    let d = computeMonth(w([], { "dc-pay": 100000 }), NOV);
    expect(cat(d, "dc-pay").available).toBe(100000);
    const pay = transfer(D, "check", "dc", 100000);
    d = computeMonth(w(pay, { "dc-pay": 100000 }), NOV);
    expect(cat(d, "dc-pay")).toMatchObject({ activity: -100000, available: 0 });
    d = computeMonth(
      w([...pay, { date: D, account: "dc", amount: -12000, category: "interest" }], {
        "dc-pay": 100000,
        interest: 20000,
      }),
      NOV,
    );
    expect(cat(d, "dc-pay").available).toBe(12000);
    expect(cat(d, "interest").available).toBe(8000);
  });
});

describe("EXF-535 two cards, and the other Lead rules", () => {
  const accts: Acct[] = [
    { id: "check", type: "checking" },
    { id: "a", type: "creditCard" },
    { id: "b", type: "creditCard" },
    { id: "trk", type: "otherAsset" },
  ];
  const cats = [{ id: "c" }, { id: "pa", accountId: "a" }, { id: "pb", accountId: "b" }];
  const w = (rows: Row[], assigned: Record<string, number> = {}, months: string[] = [NOV]) =>
    input(accts, rows, Object.fromEntries(months.map((m) => [m, assigned])), cats);
  const on = (account: string, amount: number, category: string | null = "c"): Row => ({
    date: D,
    account,
    amount,
    category,
  });

  it("two cards share the credit part in proportion", () => {
    const d = computeMonth(w([on("a", -30000), on("b", -10000)]), NOV);
    expect(cat(d, "pa").activity).toBe(0);
    expect(cat(d, "pb").activity).toBe(0);
    const e = computeMonth(w([on("a", -30000), on("b", -10000)], { c: 10001 }), NOV);
    // credit part 29999: a = 22499 (.25 rem), b = 7500 ; funded = spent - share
    expect(cat(e, "pa").activity).toBe(30000 - 22499);
    expect(cat(e, "pb").activity).toBe(10000 - 7500);
  });
  it("a tie goes to the lower account id", () => {
    const e = computeMonth(w([on("a", -10000), on("b", -10000)], { c: 19999 }), NOV);
    // available -1 -> credit part 1 to a
    expect(cat(e, "pa").activity).toBe(10000 - 1);
    expect(cat(e, "pb").activity).toBe(10000);
  });
  it("a refund on one card: the other takes the credit part", () => {
    const e = computeMonth(w([on("a", -30000), on("b", 5000)]), NOV);
    expect(cat(e, "c").overspent).toEqual({ cash: 0, credit: 25000 });
    expect(cat(e, "pa").activity).toBe(5000);
    expect(cat(e, "pb").activity).toBe(-5000);
  });
  it("a net refund is never credit overspending", () => {
    const e = computeMonth(w([on("a", 5000), on("check", -10000)]), NOV);
    expect(cat(e, "c")).toMatchObject({
      available: -5000,
      state: "cash_overspent",
      overspent: { cash: 5000, credit: 0 },
    });
  });
  it("a negative payment category is 0 next month and shows up in cash_overspending_previous", () => {
    const rows = transfer(D, "check", "a", 100000);
    const nov = computeMonth(w(rows), NOV);
    expect(cat(nov, "pa")).toMatchObject({ available: -100000, state: "cash_overspent" });
    const dec = computeMonth(w(rows), DEC);
    expect(cat(dec, "pa").available).toBe(0);
    expect(dec.rta_breakdown.cash_overspending_previous).toBe(-100000);
  });
  it("card to card moves the amount between the payment categories", () => {
    const e = computeMonth(w(transfer(D, "b", "a", 100000)), NOV);
    // b pays a: a's card row +100 -> a's payment -100; b's card row -100 -> b's payment +100
    expect(cat(e, "pa").activity).toBe(-100000);
    expect(cat(e, "pb").activity).toBe(100000);
  });
  it("a cash advance from a card raises its payment category", () => {
    const e = computeMonth(w(transfer(D, "a", "check", 50000)), NOV);
    expect(cat(e, "pa").activity).toBe(50000);
  });
  it("a row into a payment category is its activity, not credit spending", () => {
    const e = computeMonth(w([on("check", -7000, "pa"), on("a", -3000, "pb")]), NOV);
    expect(cat(e, "pa")).toMatchObject({ activity: -7000, credit_spending: 0 });
    expect(cat(e, "pb")).toMatchObject({ activity: -3000, credit_spending: 0 });
  });
  it("an uncategorized card row stays in Uncategorized and moves nothing into a payment category", () => {
    const e = computeMonth(w([on("a", -9000, null)]), NOV);
    expect(e.uncategorized).toEqual({ activity: -9000, available: -9000 });
    expect(cat(e, "pa").activity).toBe(0);
  });
  it("a card inflow to Ready to Assign raises Ready to Assign and nothing else", () => {
    const e = computeMonth(w([{ date: D, account: "a", amount: 15000, inflow: true }]), NOV);
    expect(e.ready_to_assign).toBe(15000);
    expect(cat(e, "pa").activity).toBe(0);
  });
  it("assigning to a payment category lowers Ready to Assign", () => {
    const e = computeMonth(w([], { pa: 40000 }), NOV);
    expect(e.ready_to_assign).toBe(-40000);
    expect(cat(e, "pa").available).toBe(40000);
  });
  it("the system group is listed first", () => {
    const e = computeMonth(w([]), NOV);
    expect(e.groups[0]).toMatchObject({ id: "pay", kind: "credit_card_payments" });
  });
});

// ---- the property test ----

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * For every month M:  CashBalances + CreditIntoPlan = RTA + sum(Available) + CreditParts + AssignedLater + UncatAvailable
 *  - CashBalances: rows on on-plan cash accounts dated up to M (a cash row counts whatever its category);
 *  - CreditIntoPlan: rows on cards up to M that are inflows to Ready to Assign, rows into payment categories or
 *    uncategorized (they move plan money without moving cash);
 *  - CreditParts: the credit parts of M's overspent categories; AssignedLater: assignments after M;
 *  - UncatAvailable: Uncategorized's available (negative amounts carry nowhere but into RTA's overspending, which
 *    is already inside RTA).
 */
describe("property: the identity holds for random plans (seeded)", () => {
  const MONTHS = [
    "2026-06-01",
    "2026-07-01",
    "2026-08-01",
    "2026-09-01",
    "2026-10-01",
    "2026-11-01",
  ];
  const PLANS = 250;
  for (let seed = 1; seed <= PLANS; seed++) {
    it(`seed ${seed}`, () => {
      const rnd = mulberry32(seed * 7919);
      const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
      const money = () => int(1, 400) * 250;
      const cashN = int(1, 3);
      const cardN = int(1, 3);
      const accts: Acct[] = [
        ...Array.from({ length: cashN }, (_, i) => ({
          id: `cash${i}`,
          type: (i % 2 ? "savings" : "checking") as AccountType,
        })),
        ...Array.from({ length: cardN }, (_, i) => ({
          id: `card${i}`,
          type: (i % 2 ? "lineOfCredit" : "creditCard") as AccountType,
        })),
        { id: "trk", type: "otherAsset" as AccountType },
      ];
      const ordinary = Array.from({ length: int(2, 4) }, (_, i) => `cat${i}`);
      const cats: { id: string; accountId?: string }[] = [
        ...ordinary.map((id) => ({ id })),
        ...Array.from({ length: cardN }, (_, i) => ({ id: `pay${i}`, accountId: `card${i}` })),
      ];
      const payIds = new Set(cats.filter((c) => c.accountId).map((c) => c.id));
      const catIds = cats.map((c) => c.id);
      const rows: Row[] = [];
      const assigned: Record<string, Record<string, number>> = {};
      for (const a of accts) {
        if (accountGroup(a.type) === "cash")
          rows.push({
            date: `${MONTHS[0]}`.slice(0, 8) + "02",
            account: a.id,
            amount: money() * 10,
            inflow: true,
          });
      }
      const cashIds = accts.filter((a) => accountGroup(a.type) === "cash").map((a) => a.id);
      const cardIds = accts.filter((a) => accountGroup(a.type) === "credit").map((a) => a.id);
      const pick = <T>(xs: T[]) => xs[int(0, xs.length - 1)] as T;
      for (const m of MONTHS) {
        const day = () => `${m.slice(0, 8)}${String(int(1, 28)).padStart(2, "0")}`;
        assigned[m] = {};
        for (const id of catIds) if (rnd() < 0.5) assigned[m][id] = int(0, 300) * 250;
        for (let i = int(3, 9); i > 0; i--) {
          const kind = int(0, 11);
          const date = day();
          if (kind <= 2)
            rows.push({ date, account: pick(cashIds), amount: -money(), category: pick(ordinary) });
          else if (kind <= 5)
            rows.push({ date, account: pick(cardIds), amount: -money(), category: pick(ordinary) });
          else if (kind === 6)
            rows.push({
              date,
              account: pick([...cashIds, ...cardIds]),
              amount: money(),
              category: pick(ordinary),
            }); // refund
          else if (kind === 7)
            rows.push({
              date,
              account: pick([...cashIds, ...cardIds]),
              amount: money(),
              inflow: true,
            });
          else if (kind === 8) rows.push(...transfer(date, pick(cashIds), pick(cardIds), money()));
          else if (kind === 9) {
            if (rnd() < 0.5) rows.push(...transfer(date, pick(cardIds), pick(cashIds), money()));
            else if (cardIds.length > 1) {
              const from = pick(cardIds);
              const to = pick(cardIds.filter((c) => c !== from));
              rows.push(...transfer(date, from, to, money()));
            } else rows.push(...transfer(date, "trk", pick(cashIds), money()));
          } else if (kind === 10) {
            const r = rnd();
            if (r < 0.34)
              rows.push({
                date,
                account: pick([...cashIds, ...cardIds]),
                amount: -money(),
                category: null,
              });
            else if (r < 0.67)
              rows.push({
                date,
                account: pick([...cashIds, ...cardIds]),
                amount: -money(),
                category: pick([...payIds]),
              });
            else
              rows.push({
                date,
                account: pick(cashIds),
                amount: -money(),
                category: pick(ordinary),
                peer: "trk",
              });
          } else
            rows.push({
              date,
              account: pick(cashIds),
              amount: money(),
              category: pick(ordinary),
              peer: "trk",
            });
        }
      }
      const inp = input(accts, rows, assigned, cats);
      const byAcct = new Map(accts.map((a) => [a.id, a]));
      for (const M of MONTHS) {
        const upTo = rows.filter((r) => `${r.date.slice(0, 7)}-01` <= M);
        const cash = upTo
          .filter((r) => accountGroup((byAcct.get(r.account) as Acct).type) === "cash")
          .reduce((n, r) => n + r.amount, 0);
        const creditIn = upTo
          .filter((r) => {
            if (accountGroup((byAcct.get(r.account) as Acct).type) !== "credit") return false;
            const peer = r.peer ? byAcct.get(r.peer) : undefined;
            if (peer && onBudget(peer.type)) return false;
            return r.inflow || r.category === null || payIds.has(r.category as string);
          })
          .reduce((n, r) => n + r.amount, 0);
        const d = computeMonth(inp, M);
        const all = d.groups.flatMap((g) => g.categories);
        for (const c of all) {
          if (c.overspent) {
            expect(c.overspent.cash, `seed ${seed} ${M} ${c.id}`).toBeGreaterThanOrEqual(0);
            expect(c.overspent.credit, `seed ${seed} ${M} ${c.id}`).toBeGreaterThanOrEqual(0);
            expect(c.overspent.cash + c.overspent.credit, `seed ${seed} ${M} ${c.id}`).toBe(
              -c.available,
            );
          } else expect(c.available, `seed ${seed} ${M} ${c.id}`).toBeGreaterThanOrEqual(0);
        }
        const availSum = all.reduce((n, c) => n + c.available, 0);
        const creditParts = all.reduce((n, c) => n + (c.overspent?.credit ?? 0), 0);
        const later = Object.entries(assigned)
          .filter(([m]) => m > M)
          .reduce((n, [, byCat]) => n + Object.values(byCat).reduce((x, y) => x + y, 0), 0);
        const rhs =
          d.ready_to_assign + availSum + creditParts + later + (d.uncategorized?.available ?? 0);
        expect(cash + creditIn, `seed ${seed} month ${M}`).toBe(rhs);
      }
    });
  }
});
