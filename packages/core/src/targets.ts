import { assertMilliunits, type Milliunits } from "./money";
import { addMonths, type Month, toMonth } from "./month";

// Pure target arithmetic: no I/O, no clock. "Today" is an input. See docs/targets-engine-design.md.

export const TARGET_CADENCES = ["weekly", "monthly", "yearly", "custom"] as const;
export const TARGET_BEHAVIORS = ["set_aside", "refill", "fill_up", "balance"] as const;
export const TARGET_STATUSES = [
  "underfunded",
  "funded",
  "on_track",
  "eventually",
  "snoozed",
  "complete",
] as const;
export const REPEAT_UNITS = ["month", "year"] as const;
export type TargetCadence = (typeof TARGET_CADENCES)[number];
export type TargetBehavior = (typeof TARGET_BEHAVIORS)[number];
export type TargetStatus = (typeof TARGET_STATUSES)[number];
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export interface TargetDefinition {
  cadence: TargetCadence;
  behavior: TargetBehavior;
  amount: Milliunits;
  /** 0 = Sunday ... 6 = Saturday (weekly). */
  day_of_week: number | null;
  /** 1..31 (monthly); null = last day. */
  day_of_month: number | null;
  due_date: string | null;
  due_month: Month | null;
  repeat: { every: number; unit: RepeatUnit } | null;
  created_on: string;
}

export interface TargetMonth {
  definition: TargetDefinition;
  status: TargetStatus;
  needed_this_month: Milliunits;
  amount_this_month: Milliunits;
  funded: Milliunits;
  to_go_this_month: Milliunits;
  overall_to_go: Milliunits;
  overfunded: Milliunits;
  percent: number;
  due_this_month: boolean;
  period_due_date: string | null;
}

export interface TargetMonthContext {
  month: Month;
  /** ISO date; the current month is toMonth(today). */
  today: string;
  leftover: Milliunits;
  assigned: Milliunits;
  activity: Milliunits;
  available: Milliunits;
  /** This category's Assigned in any month. */
  assignedIn: (month: Month) => Milliunits;
}

const daysIn = (month: Month): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const lastDay = (month: Month): string =>
  `${month.slice(0, 8)}${String(daysIn(month)).padStart(2, "0")}`;

const monthsBetween = (from: Month, to: Month): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/** The same day n months later, clamped to that month's last day. */
function addMonthsToDate(date: string, n: number): string {
  const m = addMonths(toMonth(date), n);
  const day = Math.min(Number(date.slice(8, 10)), daysIn(m));
  return `${m.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** n / k rounded UP to a whole cent (10 milliunits); 0 when n <= 0. */
export function ceilCent(n: Milliunits, k: number): Milliunits {
  if (n <= 0) return 0;
  const unit = 10 * k;
  const r = Math.floor((n + unit - 1) / unit) * 10;
  assertMilliunits(r);
  return r;
}

/** How many dates in `month` fall on `dayOfWeek` (0 = Sunday), optionally only those on or after `fromDate`. */
export function countWeekdays(month: Month, dayOfWeek: number, fromDate?: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  let n = 0;
  for (let d = 1; d <= daysIn(month); d++) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== dayOfWeek) continue;
    const iso = `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;
    if (fromDate !== undefined && iso < fromDate) continue;
    n++;
  }
  return n;
}

export type TargetPeriod = {
  dueDate: string;
  dueMonth: Month;
  startMonth: Month;
  monthsRemaining: number;
};

/** The period a dated target (yearly, custom set_aside / fill_up) is in for `month`. Null for other kinds. */
export function targetPeriod(
  def: TargetDefinition,
  month: Month,
): TargetPeriod | "complete" | null {
  const dated =
    def.cadence === "yearly" ||
    (def.cadence === "custom" && (def.behavior === "set_aside" || def.behavior === "fill_up"));
  if (!dated || def.due_date === null) return null;
  const createdMonth = toMonth(def.created_on);
  const firstDue = toMonth(def.due_date);
  const step =
    def.cadence === "yearly"
      ? 12
      : def.repeat
        ? def.repeat.every * (def.repeat.unit === "year" ? 12 : 1)
        : 0;
  if (step === 0) {
    if (month > firstDue) return "complete";
    return {
      dueDate: def.due_date,
      dueMonth: firstDue,
      startMonth: createdMonth,
      monthsRemaining: monthsBetween(month, firstDue) + 1,
    };
  }
  const n = month <= firstDue ? 0 : Math.ceil(monthsBetween(firstDue, month) / step);
  const dueMonth = addMonths(firstDue, n * step);
  const prevStart = n === 0 ? createdMonth : addMonths(firstDue, (n - 1) * step + 1);
  return {
    dueDate: addMonthsToDate(def.due_date, n * step),
    dueMonth,
    // biome-ignore lint/complexity/useMathMinMax: these are ISO month strings, not numbers
    startMonth: prevStart > createdMonth ? prevStart : createdMonth,
    monthsRemaining: monthsBetween(month, dueMonth) + 1,
  };
}

const pos = (n: number): number => Math.max(0, n);

function percentOf(funded: Milliunits, goal: Milliunits): number {
  if (goal <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((100 * funded) / goal)));
}

/**
 * The target's figures for one category and month, or null for months before the month it was created.
 * Every rule here copies what the source was observed to do, odd cases included (see the design).
 */
export function computeTargetMonth(
  def: TargetDefinition,
  ctx: TargetMonthContext,
): TargetMonth | null {
  const { month, leftover: L, assigned: A, activity: X, available: V } = ctx;
  const createdMonth = toMonth(def.created_on);
  if (month < createdMonth) return null;
  const T = def.amount;
  const cur = toMonth(ctx.today);

  let needed: Milliunits = 0;
  let amountThisMonth: Milliunits | null = null; // null: equals needed
  let funded: Milliunits = A;
  let toGo: Milliunits | null = null; // null: max(0, needed - A)
  let overall: Milliunits | null = null; // null: equals toGo
  let overfunded: Milliunits | null = null; // null: max(0, A - needed)
  let goal: Milliunits = 0;
  let dueThisMonth = false;
  let periodDue: string | null = null;
  let complete = false;
  let kind: "monthly" | "dated" | "eventually" = "monthly";

  const periodic = def.cadence === "weekly" || def.cadence === "monthly";
  if (periodic) {
    if (def.cadence === "weekly") {
      const dow = def.day_of_week ?? 0;
      needed = T * countWeekdays(month, dow, month === createdMonth ? def.created_on : undefined);
      amountThisMonth = T * countWeekdays(month, dow);
    } else {
      needed = T;
      const dom = def.day_of_month;
      periodDue =
        dom === null
          ? lastDay(month)
          : `${month.slice(0, 8)}${String(Math.min(dom, daysIn(month))).padStart(2, "0")}`;
    }
    if (def.behavior === "refill") {
      funded = month > cur ? A : L + A;
      amountThisMonth = amountThisMonth ?? needed;
      toGo = pos(needed - funded);
      overfunded = pos(funded - needed);
    }
    goal = needed;
    dueThisMonth = true;
  } else if (def.cadence === "custom" && def.behavior === "balance") {
    if (def.due_month === null) {
      kind = "eventually";
      funded = V;
      toGo = 0;
      overall = pos(T - V);
      overfunded = pos(Math.min(A, V - T));
      goal = T;
    } else if (month > def.due_month) {
      complete = true;
      funded = V;
      goal = T;
    } else {
      kind = "dated";
      const k = monthsBetween(month, def.due_month) + 1;
      needed = ceilCent(T - L - X, k);
      funded = V;
      overall = pos(T - V);
      goal = T;
      dueThisMonth = def.due_month === month;
      periodDue = lastDay(def.due_month);
    }
  } else {
    // yearly, custom set_aside / fill_up
    kind = "dated";
    const period = targetPeriod(def, month);
    const setAside = def.behavior === "set_aside";
    const start = period === "complete" || period === null ? createdMonth : period.startMonth;
    let before = 0;
    if (setAside) {
      for (let m = start; m < month; m = addMonths(m, 1)) before += ctx.assignedIn(m);
    }
    funded = setAside ? before + A : L + A;
    goal = T;
    if (period === "complete" || period === null) {
      complete = true;
    } else {
      needed = ceilCent(setAside ? T - before : T - L, period.monthsRemaining);
      overall = pos(T - funded);
      dueThisMonth = period.dueMonth === month;
      periodDue = period.dueDate;
    }
  }

  if (complete) {
    needed = 0;
    amountThisMonth = 0;
    toGo = 0;
    overall = 0;
    overfunded = pos(A);
    dueThisMonth = false;
    periodDue = null;
    kind = "dated";
  }

  const toGoFinal = toGo ?? pos(needed - A);
  const overallFinal = overall ?? toGoFinal;
  const overfundedFinal = overfunded ?? pos(A - needed);

  let status: TargetStatus;
  if (complete) status = "complete";
  else if (kind === "monthly") status = toGoFinal === 0 ? "funded" : "underfunded";
  else if (kind === "eventually") status = V >= T ? "funded" : "eventually";
  else if (overallFinal === 0) status = "funded";
  else status = toGoFinal === 0 ? "on_track" : "underfunded";

  return {
    definition: def,
    status,
    needed_this_month: needed,
    amount_this_month: amountThisMonth ?? needed,
    funded,
    to_go_this_month: toGoFinal,
    overall_to_go: overallFinal,
    overfunded: overfundedFinal,
    percent: percentOf(funded, goal),
    due_this_month: dueThisMonth,
    period_due_date: periodDue,
  };
}

export interface TargetBar {
  /** Section sizes, left to right; the progress bar is split in proportion to them. Empty: nothing is needed. */
  sections: Milliunits[];
  /** How much of the bar (the sum of the sections) is filled, never negative. */
  fill: Milliunits;
}

/**
 * What the grid row's progress bar shows for a target: its sections (the leftover, then what is needed this
 * month; weekly targets one section per week) and how much of them is filled.
 */
export function targetBar(t: TargetMonth, leftover: Milliunits): TargetBar {
  const def = t.definition;
  const periodic = def.cadence === "weekly" || def.cadence === "monthly";
  if (!periodic || t.status === "complete") {
    return { sections: [def.amount], fill: pos(t.funded) };
  }
  const refill = def.behavior === "refill";
  const sections: Milliunits[] = [];
  if (!refill && leftover > 0) sections.push(leftover);
  if (def.cadence === "weekly") {
    const weeks = def.amount > 0 ? Math.round(t.needed_this_month / def.amount) : 0;
    for (let i = 0; i < weeks; i++) sections.push(def.amount);
  } else if (t.needed_this_month > 0) {
    sections.push(t.needed_this_month);
  }
  return { sections, fill: refill ? pos(t.funded) : pos(leftover + t.funded) };
}
