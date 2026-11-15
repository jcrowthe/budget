import type { AccountType } from "./account-types";
import { addMilliunits, type Milliunits } from "./money";
import { addMonths, isMonth, type Month, toMonth } from "./month";
import { computeTargetMonth, type TargetDefinition, type TargetMonth } from "./targets";

// Pure month arithmetic for the Plan: no I/O. See docs/budget-engine-design.md.

export interface EngineGroup {
  id: string;
  name: string;
  sortOrder: number;
  hidden: boolean;
  collapsed: boolean;
}
export interface EngineCategory {
  id: string;
  groupId: string;
  name: string;
  sortOrder: number;
  hidden: boolean;
}
export interface EngineAssignment {
  categoryId: string;
  month: Month;
  assigned: Milliunits;
}
export interface EngineActivity {
  /** ISO date (any day; a pre-summed row uses the month's first day). */
  date: string;
  /** Signed: outflow < 0. */
  amount: Milliunits;
  categoryId: string | null;
  inflowToReadyToAssign: boolean;
  onBudget: boolean;
  accountType: AccountType;
}
export interface EngineNote {
  month: Month;
  note: string | null;
}
export interface EngineTarget extends TargetDefinition {
  categoryId: string;
}
export interface EngineInput {
  groups: EngineGroup[];
  categories: EngineCategory[];
  assignments: EngineAssignment[];
  activity: EngineActivity[];
  notes: EngineNote[];
  /** At most one per category. */
  targets?: EngineTarget[];
  /** ISO date; required when `targets` is not empty (the engine never reads the clock). */
  today?: string;
}

export type Classified =
  | { kind: "ignored" }
  | { kind: "rta_inflow" }
  | { kind: "category"; categoryId: string }
  | { kind: "uncategorized" };

/**
 * The single place for counting rules. Credit rules (payment categories, credit overspending) will extend
 * this later; until then a categorized credit-account transaction counts like any on-plan transaction.
 */
export function classifyTransaction(
  a: EngineActivity,
  activeCategoryIds: ReadonlySet<string>,
): Classified {
  if (!a.onBudget) return { kind: "ignored" };
  if (a.inflowToReadyToAssign) return { kind: "rta_inflow" };
  if (a.categoryId !== null && activeCategoryIds.has(a.categoryId)) {
    return { kind: "category", categoryId: a.categoryId };
  }
  return { kind: "uncategorized" };
}

export interface RtaBreakdown {
  left_over_from_previous: Milliunits;
  inflows: Milliunits;
  cash_overspending_previous: Milliunits;
  assigned_in_month: Milliunits;
  assigned_in_future: Milliunits;
}
export interface MonthCategoryDetail {
  id: string;
  name: string;
  sort: number;
  hidden: boolean;
  assigned: Milliunits;
  activity: Milliunits;
  available: Milliunits;
  carried: Milliunits;
  target: TargetMonth | null;
}
export interface MonthGroupDetail {
  id: string;
  name: string;
  sort: number;
  hidden: boolean;
  collapsed: boolean;
  assigned: Milliunits;
  activity: Milliunits;
  available: Milliunits;
  categories: MonthCategoryDetail[];
}
export interface MonthDetail {
  month: Month;
  note: string | null;
  ready_to_assign: Milliunits;
  rta_breakdown: RtaBreakdown;
  groups: MonthGroupDetail[];
  uncategorized: { activity: Milliunits; available: Milliunits } | null;
}
export interface MonthSummary {
  month: Month;
  note: string | null;
  ready_to_assign: Milliunits;
  assigned: Milliunits;
  activity: Milliunits;
  available: Milliunits;
}

interface CatState {
  carried: Milliunits;
  assigned: Milliunits;
  activity: Milliunits;
  available: Milliunits;
}
interface MonthState {
  month: Month;
  cats: Map<string, CatState>;
  uncat: { carried: Milliunits; activity: Milliunits; available: Milliunits; hasRows: boolean };
  /** Cash overspending created in this month (>= 0), charged to the next month. */
  overspending: Milliunits;
  inflows: Milliunits;
  assignedTotal: Milliunits;
}

/** Negation that never yields -0. */
const neg = (n: Milliunits): Milliunits => (n === 0 ? 0 : -n);

const bySort = <T extends { sortOrder: number; id: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function add(m: Map<string, number>, key: string, n: Milliunits) {
  m.set(key, addMilliunits(m.get(key) ?? 0, n));
}

function monthsBetween(from: Month, to: Month): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)))
  );
}

interface Prepared {
  input: EngineInput;
  activeCats: EngineCategory[];
  activeIds: Set<string>;
  assignedByCatMonth: Map<string, Milliunits>; // `${month}|${cat}`
  assignedByMonth: Map<Month, Milliunits>;
  catActivity: Map<string, Milliunits>; // `${month}|${cat}`
  uncatActivity: Map<Month, Milliunits>;
  inflowByMonth: Map<Month, Milliunits>;
  earliest: Month | null;
}

function prepare(input: EngineInput): Prepared {
  const groupIds = new Set(input.groups.map((g) => g.id));
  const activeCats = input.categories.filter((c) => groupIds.has(c.groupId));
  const activeIds = new Set(activeCats.map((c) => c.id));
  const p: Prepared = {
    input,
    activeCats,
    activeIds,
    assignedByCatMonth: new Map(),
    assignedByMonth: new Map(),
    catActivity: new Map(),
    uncatActivity: new Map(),
    inflowByMonth: new Map(),
    earliest: null,
  };
  const seen = (m: Month) => {
    if (p.earliest === null || m < p.earliest) p.earliest = m;
  };
  for (const a of input.assignments) {
    if (!activeIds.has(a.categoryId)) continue;
    add(p.assignedByCatMonth, `${a.month}|${a.categoryId}`, a.assigned);
    add(p.assignedByMonth, a.month, a.assigned);
    seen(a.month);
  }
  for (const t of input.activity) {
    const k = classifyTransaction(t, activeIds);
    if (k.kind === "ignored") continue;
    const m = toMonth(t.date);
    seen(m);
    if (k.kind === "rta_inflow") add(p.inflowByMonth, m, t.amount);
    else if (k.kind === "category") add(p.catActivity, `${m}|${k.categoryId}`, t.amount);
    else add(p.uncatActivity, m, t.amount);
  }
  return p;
}

function timeline(p: Prepared, start: Month, end: Month): MonthState[] {
  const states: MonthState[] = [];
  const n = monthsBetween(start, end);
  let prev: MonthState | null = null;
  for (let i = 0; i <= n; i++) {
    const month = addMonths(start, i);
    const cats = new Map<string, CatState>();
    let overspending = 0;
    for (const c of p.activeCats) {
      const carried = Math.max(prev?.cats.get(c.id)?.available ?? 0, 0);
      const assigned = p.assignedByCatMonth.get(`${month}|${c.id}`) ?? 0;
      const activity = p.catActivity.get(`${month}|${c.id}`) ?? 0;
      const available = addMilliunits(carried, assigned, activity);
      cats.set(c.id, { carried, assigned, activity, available });
      overspending = addMilliunits(overspending, Math.max(-available, 0));
    }
    const uCarried = Math.max(prev?.uncat.available ?? 0, 0);
    const uActivity = p.uncatActivity.get(month) ?? 0;
    const uAvailable = addMilliunits(uCarried, uActivity);
    overspending = addMilliunits(overspending, Math.max(-uAvailable, 0));
    const state: MonthState = {
      month,
      cats,
      uncat: {
        carried: uCarried,
        activity: uActivity,
        available: uAvailable,
        hasRows: p.uncatActivity.has(month),
      },
      overspending,
      inflows: p.inflowByMonth.get(month) ?? 0,
      assignedTotal: p.assignedByMonth.get(month) ?? 0,
    };
    states.push(state);
    prev = state;
  }
  return states;
}

function sum(states: MonthState[], f: (s: MonthState) => Milliunits): Milliunits {
  return addMilliunits(...states.map(f));
}

function rtaFor(p: Prepared, states: MonthState[], idx: number) {
  const upTo = states.slice(0, idx + 1);
  const before = states.slice(0, idx);
  const beforePrev = states.slice(0, Math.max(idx - 1, 0));
  const upToPrev = before;
  const assignedAll = addMilliunits(...[...p.assignedByMonth.values()]);
  const month = states[idx] as MonthState;
  const prevOverspend = idx > 0 ? (states[idx - 1] as MonthState).overspending : 0;
  const assignedThroughPrev = sum(upToPrev, (s) => s.assignedTotal);
  const leftOver = addMilliunits(
    sum(upToPrev, (s) => s.inflows),
    neg(sum(beforePrev, (s) => s.overspending)),
    neg(assignedThroughPrev),
  );
  const breakdown: RtaBreakdown = {
    left_over_from_previous: leftOver,
    inflows: month.inflows,
    cash_overspending_previous: neg(prevOverspend),
    assigned_in_month: neg(month.assignedTotal),
    assigned_in_future: neg(
      addMilliunits(assignedAll, neg(assignedThroughPrev), neg(month.assignedTotal)),
    ),
  };
  const rta = addMilliunits(
    sum(upTo, (s) => s.inflows),
    neg(sum(before, (s) => s.overspending)),
    neg(assignedAll),
  );
  const parts = addMilliunits(
    breakdown.left_over_from_previous,
    breakdown.inflows,
    breakdown.cash_overspending_previous,
    breakdown.assigned_in_month,
    breakdown.assigned_in_future,
  );
  if (parts !== rta) throw new Error("RTA breakdown does not sum to Ready to Assign");
  return { rta, breakdown };
}

function noteFor(input: EngineInput, month: Month): string | null {
  return input.notes.find((n) => n.month === month)?.note ?? null;
}

function assertMonth(m: Month) {
  if (!isMonth(m)) throw new RangeError(`Not a month: ${m}`);
}

export function computeMonth(input: EngineInput, month: Month): MonthDetail {
  assertMonth(month);
  const p = prepare(input);
  const start = p.earliest !== null && p.earliest < month ? p.earliest : month;
  const states = timeline(p, start, month);
  const idx = states.length - 1;
  const state = states[idx] as MonthState;
  const { rta, breakdown } = rtaFor(p, states, idx);

  const targetsByCat = new Map((input.targets ?? []).map((t) => [t.categoryId, t]));
  if (targetsByCat.size > 0 && input.today === undefined) {
    throw new RangeError("today is required when targets are given");
  }
  const today = input.today ?? "";

  const catsByGroup = new Map<string, EngineCategory[]>();
  for (const c of p.activeCats) {
    const list = catsByGroup.get(c.groupId) ?? [];
    list.push(c);
    catsByGroup.set(c.groupId, list);
  }
  const targetFor = (categoryId: string, s: CatState): TargetMonth | null => {
    const t = targetsByCat.get(categoryId);
    if (!t) return null;
    const { categoryId: _id, ...def } = t;
    return computeTargetMonth(def, {
      month,
      today,
      leftover: s.carried,
      assigned: s.assigned,
      activity: s.activity,
      available: s.available,
      assignedIn: (m) => p.assignedByCatMonth.get(`${m}|${categoryId}`) ?? 0,
    });
  };
  const groups: MonthGroupDetail[] = [...input.groups].sort(bySort).map((g) => {
    const cats = (catsByGroup.get(g.id) ?? []).sort(bySort).map((c): MonthCategoryDetail => {
      const s = state.cats.get(c.id) as CatState;
      return {
        id: c.id,
        name: c.name,
        sort: c.sortOrder,
        hidden: c.hidden,
        assigned: s.assigned,
        activity: s.activity,
        available: s.available,
        carried: s.carried,
        target: targetFor(c.id, s),
      };
    });
    const visible = cats.filter((c) => !c.hidden);
    return {
      id: g.id,
      name: g.name,
      sort: g.sortOrder,
      hidden: g.hidden,
      collapsed: g.collapsed,
      assigned: addMilliunits(...visible.map((c) => c.assigned)),
      activity: addMilliunits(...visible.map((c) => c.activity)),
      available: addMilliunits(...visible.map((c) => c.available)),
      categories: cats,
    };
  });
  const showUncat = state.uncat.hasRows || state.uncat.available !== 0;
  return {
    month,
    note: noteFor(input, month),
    ready_to_assign: rta,
    rta_breakdown: breakdown,
    groups,
    uncategorized: showUncat
      ? { activity: state.uncat.activity, available: state.uncat.available }
      : null,
  };
}

export function computeMonths(input: EngineInput, from: Month, to: Month): MonthSummary[] {
  assertMonth(from);
  assertMonth(to);
  if (to < from) throw new RangeError("`to` is before `from`");
  const p = prepare(input);
  const start = p.earliest !== null && p.earliest < from ? p.earliest : from;
  const states = timeline(p, start, to);
  const offset = monthsBetween(start, from);
  return states.slice(offset).map((s, i) => {
    const cats = [...s.cats.values()];
    return {
      month: s.month,
      note: noteFor(input, s.month),
      ready_to_assign: rtaFor(p, states, offset + i).rta,
      assigned: addMilliunits(...cats.map((c) => c.assigned)),
      activity: addMilliunits(...cats.map((c) => c.activity)),
      available: addMilliunits(...cats.map((c) => c.available)),
    };
  });
}
