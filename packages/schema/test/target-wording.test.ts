import { describe, expect, it } from "vitest";
import { DEFAULT_FORMATTER } from "../src/plan-formats";
import type { FormTab } from "../src/target-wording";
import {
  behaviorOptions,
  ordinal,
  type TargetCategory,
  targetBreakdown,
  targetDonut,
  targetEmptyText,
  targetHeading,
  targetMessage,
  targetPill,
  targetStatusText,
} from "../src/target-wording";
import type { CategoryTargetMonth, TargetDefinition } from "../src/targets";

// The figures are written literally (schema does not import core); core's tests compute them with the engine.
const D = (o: Partial<TargetDefinition>): TargetDefinition => ({
  cadence: "monthly",
  behavior: "set_aside",
  amount: 100000,
  day_of_week: null,
  day_of_month: null,
  due_date: null,
  due_month: null,
  repeat: null,
  created_on: "2026-11-01",
  ...o,
});
interface Row {
  name: string;
  def: Partial<TargetDefinition>;
  fig: Partial<CategoryTargetMonth>;
  carried?: number;
  assigned?: number;
  activity?: number;
  available?: number;
  // the expected strings (only what each row is about)
  status?: string | null;
  pillTitle?: string;
  pillTone?: string;
  pillIcon?: string | null;
  heading?: string;
  sub?: string;
  message?: string | null;
  assign?: number | null;
  donut?: number | null;
  rows?: string[];
}
const cat = (r: Row): TargetCategory => {
  const def = D(r.def);
  const assigned = r.assigned ?? 0;
  const fig: CategoryTargetMonth = {
    definition: def,
    status: "underfunded",
    needed_this_month: def.amount,
    amount_this_month: def.amount,
    funded: assigned,
    to_go_this_month: Math.max(0, def.amount - assigned),
    overall_to_go: Math.max(0, def.amount - assigned),
    overfunded: 0,
    percent: 0,
    due_this_month: true,
    period_due_date: null,
    ...r.fig,
  };
  return {
    carried: r.carried ?? 0,
    assigned,
    activity: r.activity ?? 0,
    available: r.available ?? (r.carried ?? 0) + assigned + (r.activity ?? 0),
    target: fig,
  };
};
const MONTHLY30 = { period_due_date: "2026-11-30" };
const YEARLY = {
  cadence: "yearly",
  amount: 1200000,
  due_date: "2027-10-31",
} as const;
const BAL = {
  cadence: "custom",
  behavior: "balance",
  amount: 600000,
  due_month: "2027-04-01",
} as const;

const rows: Row[] = [
  // EXF-514 grid row: "$100.00 more needed by the 30th" (30-day month, no day set)
  {
    name: "monthly nothing assigned",
    def: {},
    fig: MONTHLY30,
    status: "$100.00 more needed by the 30th",
    pillTone: "cautious",
    pillTitle: "Assign $100.00 more to fund your $100.00 monthly target.",
    heading: "Set Aside Another $100.00 Each Month",
    sub: "By the End of the Month",
    message: "Assign $100.00 to meet your target",
    assign: 100000,
    donut: 0,
    rows: ["Amount to Assign This Month=$100.00", "Assigned So Far=$0.00", "To Go=$100.00"],
  },
  // acceptance 1: monthly $100, 40 assigned
  {
    name: "monthly 40 of 100",
    def: {},
    assigned: 40000,
    fig: { ...MONTHLY30, percent: 40, to_go_this_month: 60000 },
    status: "$60.00 more needed by the 30th",
    pillTone: "cautious",
    pillIcon: "clock",
    pillTitle: "Assign $60.00 more to fund your $100.00 monthly target.",
    message: "Assign $60.00 more to meet your target",
    assign: 60000,
    donut: 40,
    rows: ["Amount to Assign This Month=$100.00", "Assigned So Far=$40.00", "To Go=$60.00"],
  },
  // "$50.00 more needed this month" (weekly set aside)
  {
    name: "weekly half funded",
    def: { cadence: "weekly", amount: 25000, day_of_week: 6 },
    assigned: 25000,
    fig: { needed_this_month: 100000, amount_this_month: 100000, to_go_this_month: 50000 },
    status: "$50.00 more needed this month",
    heading: "Set Aside Another $25.00 Each Week",
    sub: "By Saturday",
    message: "Assign $50.00 more to meet your target",
    pillTitle: "Assign $50.00 more to fund your $100.00 monthly target.",
  },
  // "$100.00 more needed by the 31st"
  {
    name: "monthly day 31",
    def: { day_of_month: 31 },
    fig: { period_due_date: "2026-12-31" },
    status: "$100.00 more needed by the 31st",
  },
  // "$70.00 more needed by the 31st"
  {
    name: "monthly 30 assigned",
    def: {},
    assigned: 30000,
    fig: { period_due_date: "2026-12-31", to_go_this_month: 70000 },
    status: "$70.00 more needed by the 31st",
  },
  // "by the 10th", "by the 25th"
  {
    name: "monthly day 10",
    def: { day_of_month: 10 },
    fig: { period_due_date: "2026-11-10" },
    status: "$100.00 more needed by the 10th",
    sub: "By the 10th of the Month",
  },
  {
    name: "monthly day 25",
    def: { day_of_month: 25 },
    fig: { period_due_date: "2026-11-25" },
    status: "$100.00 more needed by the 25th",
  },
  // refill drops "more" while nothing is funded: "$100.00 needed by the 30th", "$100.00 needed this month"
  {
    name: "refill unfunded",
    def: { behavior: "refill" },
    fig: MONTHLY30,
    status: "$100.00 needed by the 30th",
    heading: "Refill Up to $100.00 Each Month",
    message: "Assign $100.00 to meet your target",
    rows: ["Needed This Month=$100.00", "Funded=$0.00", "To Go=$100.00"],
  },
  {
    name: "weekly refill unfunded",
    def: { cadence: "weekly", behavior: "refill", amount: 25000, day_of_week: 6 },
    fig: { needed_this_month: 100000 },
    status: "$25.00 needed this month",
    heading: "Refill Up to $25.00 Each Week",
    sub: "By Saturday",
  },
  // refill with funding says "more"
  {
    name: "refill half funded",
    def: { behavior: "refill" },
    carried: 20000,
    assigned: 30000,
    fig: { ...MONTHLY30, funded: 50000, to_go_this_month: 50000 },
    status: "$50.00 more needed by the 30th",
    message: "Assign $50.00 more to meet your target",
  },
  // "Custom due this month: $30.00 more needed by December 31st" (fill up)
  {
    name: "fill up due this month",
    def: { cadence: "custom", behavior: "fill_up", amount: 80000, due_date: "2026-12-31" },
    carried: 50000,
    fig: {
      period_due_date: "2026-12-31",
      funded: 50000,
      to_go_this_month: 30000,
      overall_to_go: 30000,
      needed_this_month: 80000,
    },
    status: "$30.00 more needed by December 31st",
    pillTone: "cautious",
    pillTitle:
      "Your $80.00 target is due this month, and you're short by $30.00. Assign another $30.00 to fund your target.",
    heading: "Fill Up to $80.00",
    sub: "By Dec 31 2026",
    message: "Assign $30.00 this month to stay on track",
    rows: ["Needed by Dec 31 2026=$80.00", "Funded=$50.00", "To Go=$30.00"],
  },
  // yearly not due this month: "$100.00 more needed this month" with the stay-on-track title
  {
    name: "yearly underfunded",
    def: YEARLY,
    fig: {
      period_due_date: "2027-10-31",
      due_this_month: false,
      needed_this_month: 100000,
      to_go_this_month: 100000,
      overall_to_go: 1200000,
    },
    status: "$100.00 more needed this month",
    pillTone: "cautious",
    pillTitle: "Assign $100.00 more to stay on track towards funding your $1,200.00 target.",
    heading: "Set Aside Another $1,200.00 Each Year",
    sub: "By Oct 31 2027",
    message: "Assign $100.00 this month to stay on track",
    donut: 0,
    rows: ["Total to Assign by Oct 31 2027=$1,200.00", "Assigned So Far=$0.00", "To Go=$1,200.00"],
  },
  // acceptance 4: yearly $1,200 with 100 assigned
  {
    name: "yearly on track",
    def: YEARLY,
    assigned: 100000,
    fig: {
      status: "on_track",
      period_due_date: "2027-10-31",
      due_this_month: false,
      needed_this_month: 100000,
      to_go_this_month: 0,
      overall_to_go: 1100000,
      percent: 8,
    },
    status: "On Track",
    pillTone: "positive",
    pillIcon: "clockCheck",
    pillTitle: "You're on track to fund your $1,200.00 target by October of 2027.",
    message: "You're on track to meet your target!",
    assign: null,
    donut: 8,
  },
  {
    name: "yearly on track with spending",
    def: YEARLY,
    carried: 0,
    assigned: 103340,
    activity: -20000,
    fig: { status: "on_track", period_due_date: "2027-10-31", to_go_this_month: 0 },
    status: "On Track. Spent $20.00 of $103.34",
  },
  // "Assign $3.34 more this month to stay on track" (yearly, some assigned)
  {
    name: "yearly short by a little",
    def: YEARLY,
    assigned: 96660,
    fig: { period_due_date: "2027-10-31", due_this_month: false, to_go_this_month: 3340 },
    message: "Assign $3.34 more this month to stay on track",
    assign: 3340,
  },
  // custom set aside due later, repeating every 3 months
  {
    name: "custom set aside repeating",
    def: {
      cadence: "custom",
      amount: 90000,
      due_date: "2027-01-15",
      repeat: { every: 3, unit: "month" },
    },
    fig: { period_due_date: "2027-01-15" },
    heading: "Set Aside Another $90.00 Every 3 Months",
    sub: "By Jan 15 2027",
  },
  {
    name: "custom set aside every 1 month",
    def: {
      cadence: "custom",
      amount: 90000,
      due_date: "2027-01-15",
      repeat: { every: 1, unit: "month" },
    },
    fig: { period_due_date: "2027-01-15" },
    heading: "Set Aside Another $90.00 Every Month",
  },
  {
    name: "custom set aside every 2 years",
    def: {
      cadence: "custom",
      amount: 90000,
      due_date: "2027-01-15",
      repeat: { every: 2, unit: "year" },
    },
    fig: { period_due_date: "2027-01-15" },
    heading: "Set Aside Another $90.00 Every 2 Years",
  },
  // "Set Aside Another $300.00" / "By Jan 31 2027"
  {
    name: "custom set aside once",
    def: { cadence: "custom", amount: 300000, due_date: "2027-01-31" },
    fig: { period_due_date: "2027-01-31", due_this_month: false },
    heading: "Set Aside Another $300.00",
    sub: "By Jan 31 2027",
    rows: ["Total to Assign by Jan 31 2027=$300.00", "Assigned So Far=$0.00", "To Go=$300.00"],
  },
  // balance by a date
  {
    name: "balance dated",
    def: BAL,
    carried: 150000,
    fig: {
      period_due_date: "2027-04-30",
      due_this_month: false,
      funded: 150000,
      to_go_this_month: 3340,
      overall_to_go: 450000,
      percent: 25,
    },
    status: "$3.34 more needed this month",
    pillTone: "cautious",
    pillTitle: "Assign $3.34 more to stay on track towards reaching your $600.00 target.",
    heading: "Have a Balance of $600.00",
    sub: "By Apr 2027",
    rows: ["Balance Needed by Apr 2027=$600.00", "Current Balance=$150.00", "To Go=$450.00"],
    donut: 25,
  },
  {
    name: "balance on track",
    def: BAL,
    carried: 150000,
    fig: { status: "on_track", period_due_date: "2027-04-30", due_this_month: false },
    pillTitle: "You're on track to reach your $600.00 target by April of 2027.",
    pillIcon: "clockCheck",
  },
  // acceptance 5: balance with no date
  {
    name: "balance eventually",
    def: { cadence: "custom", behavior: "balance", amount: 60000 },
    fig: { status: "eventually", funded: 0, overall_to_go: 60000, due_this_month: false },
    status: "$60.00 needed eventually",
    pillTone: "zero",
    pillIcon: null,
    pillTitle: "",
    heading: "Have a Balance of $60.00",
    sub: "Eventually",
    message: null,
    rows: ["Balance Needed=$60.00", "Current Balance=$0.00", "To Go=$60.00"],
    donut: 0,
  },
  {
    name: "balance eventually partly there",
    def: { cadence: "custom", behavior: "balance", amount: 60000 },
    carried: 20000,
    fig: { status: "eventually", funded: 20000, overall_to_go: 40000 },
    status: "$40.00 more needed eventually",
  },
  // acceptance 2: funded
  {
    name: "monthly funded",
    def: {},
    assigned: 100000,
    fig: { status: "funded", to_go_this_month: 0, percent: 100, ...MONTHLY30 },
    status: "Funded",
    pillTone: "positive",
    pillIcon: "check",
    pillTitle: "You've funded your $100.00 target for the month!",
    message: "You've met your target!",
    assign: null,
    donut: null,
  },
  // acceptance 3: after spending 30
  {
    name: "monthly funded then spent",
    def: {},
    assigned: 100000,
    activity: -30000,
    fig: { status: "funded", to_go_this_month: 0, percent: 100, ...MONTHLY30 },
    status: "Funded. Spent $30.00 of $100.00",
    pillTone: "positive",
    pillIcon: "check",
  },
  // funded at $0.00 stays grey
  {
    name: "monthly funded then all spent",
    def: {},
    assigned: 100000,
    activity: -100000,
    fig: { status: "funded", to_go_this_month: 0, ...MONTHLY30 },
    status: "Funded. Spent $100.00 of $100.00",
    pillTone: "zero",
    pillIcon: null,
  },
  // weekly funded: no donut
  {
    name: "weekly funded",
    def: { cadence: "weekly", amount: 25000, day_of_week: 6 },
    assigned: 100000,
    fig: { status: "funded", to_go_this_month: 0, needed_this_month: 100000 },
    donut: null,
    message: "You've met your target!",
  },
  // funded fill up: "You've funded your $80.00 target!"
  {
    name: "fill up funded",
    def: { cadence: "custom", behavior: "fill_up", amount: 80000, due_date: "2026-12-31" },
    carried: 80000,
    fig: { status: "funded", funded: 80000, to_go_this_month: 0, overall_to_go: 0, percent: 100 },
    pillTitle: "You've funded your $80.00 target!",
    donut: 100,
  },
  // complete: "Funded", no donut, no message, the breakdown stays
  {
    name: "complete",
    def: { cadence: "custom", amount: 300000, due_date: "2027-01-31" },
    carried: 300000,
    fig: {
      status: "complete",
      funded: 300000,
      to_go_this_month: 0,
      overall_to_go: 0,
      period_due_date: null,
      due_this_month: false,
    },
    status: "Funded",
    pillTitle: "You've funded your $300.00 target!",
    message: null,
    donut: null,
    heading: "Set Aside Another $300.00",
    sub: "By Jan 31 2027",
    rows: ["Total to Assign by Jan 31 2027=$300.00", "Assigned So Far=$300.00", "To Go=$0.00"],
  },
  // overspent: the grid keeps its own label and the red pill
  {
    name: "overspent",
    def: {},
    assigned: 100000,
    activity: -130000,
    fig: { ...MONTHLY30 },
    status: null,
    pillTone: "negative",
    pillIcon: null,
  },
];

const targetMoney = DEFAULT_FORMATTER.money;

describe("target wording", () => {
  it.each(rows)("$name", (r) => {
    const c = cat(r);
    if (r.status !== undefined) {
      const s = targetStatusText(c);
      expect(s === null ? null : `${s.amount ?? ""}${s.text}`.trim()).toBe(r.status);
    }
    const pill = targetPill(c);
    if (r.pillTone !== undefined) expect(pill.tone).toBe(r.pillTone);
    if (r.pillIcon !== undefined) expect(pill.icon).toBe(r.pillIcon);
    if (r.pillTitle !== undefined) expect(pill.title).toBe(r.pillTitle);
    const t = c.target as CategoryTargetMonth;
    if (r.heading !== undefined) expect(targetHeading(t).heading).toBe(r.heading);
    if (r.sub !== undefined) expect(targetHeading(t).subheading).toBe(r.sub);
    if (r.message !== undefined) {
      expect(targetMessage(c)?.text ?? null).toBe(r.message);
    }
    if (r.assign !== undefined) expect(targetMessage(c)?.assign ?? null).toBe(r.assign);
    if (r.donut !== undefined) expect(targetDonut(c)).toBe(r.donut);
    if (r.rows !== undefined) {
      const got = targetBreakdown(c).map((b) => `${b.label}=${targetMoney(b.amount)}`);
      // the "To Go" amount depends on the row's figures; compare the labels and the first amounts
      expect(got.map((g) => g.split("=")[0])).toEqual(r.rows.map((g) => g.split("=")[0]));
      expect(got.slice(0, 2)).toEqual(r.rows.slice(0, 2));
    }
  });

  it("a rule goes before To Go only", () => {
    const b = targetBreakdown(cat({ name: "x", def: {}, fig: {} }));
    expect(b.map((x) => x.rule)).toEqual([false, false, true]);
  });
});

describe("helpers and form copy", () => {
  it("formats money with a real minus", () => {
    expect(targetMoney(1200000)).toBe("$1,200.00");
    expect(targetMoney(-30000)).toBe("−$30.00");
  });
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [31, "31st"],
  ])("ordinal %i", (n, s) => expect(ordinal(n)).toBe(s));

  it("empty card text", () => {
    expect(targetEmptyText("Rent")).toEqual({
      question: "How much do you need for Rent?",
      body: "When you create a target, we’ll let you know how much money to set aside to stay on track over time.",
    });
  });

  it.each<[FormTab, string, string, string]>([
    [
      "monthly",
      "Set aside another $100.00",
      "Refill up to $100.00",
      "toward next month's $100.00.",
    ],
    [
      "weekly",
      "Set aside another $100.00/week",
      "Refill up to $100.00/week",
      "towards next month.",
    ],
    ["yearly", "Set aside another $100.00", "Refill up to $100.00", "toward next year's $100.00."],
  ])("%s behaviour options", (tab, a, b, end) => {
    const [x, y] = behaviorOptions(tab, 100000);
    expect(x?.title).toBe(a);
    expect(x?.use).toBe("Use for: bills, subscriptions, saving over time");
    expect(x?.badge).toBe("Most people choose this");
    expect(y?.title).toBe(b);
    expect(y?.use).toBe("Use for: gasoline, fun money, dining out");
    expect(y?.tagline?.endsWith(end)).toBe(true);
    expect(y?.tagline?.startsWith("Sets a Target to have $100.00")).toBe(true);
  });
  it("yearly refill says each year", () => {
    expect(behaviorOptions("yearly", 100000)[1]?.tagline).toBe(
      "Sets a Target to have $100.00 on hand each year. Whatever you don't spend will get applied toward next year's $100.00.",
    );
  });
  it("custom behaviour options", () => {
    const o = behaviorOptions("custom", 100000);
    expect(o.map((x) => x.title)).toEqual([
      "Set aside $100.00",
      "Fill up to $100.00",
      "Have a balance of $100.00",
    ]);
    expect(o.map((x) => x.use)).toEqual([
      "Use for: bills, subscriptions, saving over time",
      "Use for: gasoline, fun money, dining out",
      "Use for: long-term savings",
    ]);
    expect(o.map((x) => x.tagline)).toEqual([
      "Add $100.00 to this category, regardless of its current balance.",
      "Use what is already in this category and fill it up to $100.00.",
      "Reach this amount by a specific time and refrain from spending until you reach it.",
    ]);
    expect(o.every((x) => x.badge === null)).toBe(true);
  });
  it("without a target everything is empty", () => {
    const c = { carried: 0, assigned: 0, activity: 0, available: 0, target: null };
    expect(targetStatusText(c)).toBeNull();
    expect(targetMessage(c)).toBeNull();
    expect(targetDonut(c)).toBeNull();
    expect(targetBreakdown(c)).toEqual([]);
    expect(targetPill(c)).toEqual({ tone: "zero", icon: null, title: "" });
  });
});

describe("snoozed target", () => {
  const snoozed = (): TargetCategory => {
    const c = cat({
      name: "s",
      def: {},
      assigned: 40000,
      fig: { ...MONTHLY30, to_go_this_month: 60000 },
    });
    return c.target ? { ...c, target: { ...c.target, status: "snoozed" } } : c;
  };
  it("pill is green with the snooze icon and the plain title", () => {
    expect(targetPill(snoozed())).toEqual({
      tone: "positive",
      icon: "snooze",
      title: "$40.00 Available to plan your spending—or click to move it to another category!",
    });
  });
  it("no status text, donut or message; the breakdown stays", () => {
    const c = snoozed();
    expect(targetStatusText(c)).toBeNull();
    expect(targetDonut(c)).toBeNull();
    expect(targetMessage(c)).toBeNull();
    expect(c.target && targetBreakdown(c).length).toBeGreaterThan(0);
  });
});

// EXF-545: a loan's paired category says "needed by", never "more", until something is assigned.
describe("debt payment target wording", () => {
  const paired = (o: Partial<TargetCategory> & { paired_account_id: string | null }) => {
    const def = D({ amount: 1500000 });
    return {
      carried: 0,
      assigned: 0,
      activity: 0,
      available: 0,
      target: {
        definition: def,
        status: "underfunded",
        needed_this_month: 1500000,
        amount_this_month: 1500000,
        funded: 0,
        to_go_this_month: 1500000,
        overall_to_go: 1500000,
        overfunded: 0,
        percent: 0,
        due_this_month: true,
        period_due_date: "2026-11-30",
      },
      ...o,
    } as TargetCategory;
  };
  const say = (c: TargetCategory) => targetStatusText(c);
  it("underfunded: needed by the 30th", () => {
    expect(say(paired({ paired_account_id: "loan-1" }))).toEqual({
      amount: "$1,500.00",
      text: " needed by the 30th",
    });
  });
  it("funded and fully spent: Fully Spent", () => {
    const c = paired({ paired_account_id: "loan-1", assigned: 1500000, activity: -1500000 });
    (c.target as CategoryTargetMonth).status = "funded";
    (c.target as CategoryTargetMonth).funded = 1500000;
    expect(say(c)).toEqual({ amount: null, text: "Fully Spent" });
  });
  it("an unpaired category keeps its wording", () => {
    expect(say(paired({ paired_account_id: null }))).toEqual({
      amount: "$1,500.00",
      text: " more needed by the 30th",
    });
  });
});
