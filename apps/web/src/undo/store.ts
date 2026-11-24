import type { UndoResult, UndoWhere } from "@budget/schema/changes";
import { undoChangeSet as realUndo } from "../api/changes";
import { ApiError } from "../api/client";

/** Per-plan Undo and Redo stacks, in memory: per tab, a reload clears them (docs/undo-design.md, D2). No React. */
export type Origin = "register" | "plan" | "payees";
export interface Entry {
  changeSetId: string;
  origin: Origin;
  seq: number;
  where?: UndoWhere;
}
export interface Stacks {
  undo: Entry[];
  redo: Entry[];
  busy: boolean;
}
export interface Scope {
  origin: Origin;
  since: number;
}

export const CAP = 100;

let call: (budgetId: string, id: string) => Promise<UndoResult> = realUndo;
export function configureUndo(o: { undoChangeSet: typeof call }) {
  call = o.undoChangeSet;
}

const plans = new Map<string, Stacks>();
const listeners = new Set<() => void>();
let seq = 0;

const EMPTY: Stacks = Object.freeze({ undo: [], redo: [], busy: false }) as Stacks;

function stacksOf(budgetId: string): Stacks {
  let s = plans.get(budgetId);
  if (!s) {
    s = { undo: [], redo: [], busy: false };
    plans.set(budgetId, s);
  }
  return s;
}

/** Replaces the plan's stacks with a new object, so `getSnapshot` changes identity for `useSyncExternalStore`. */
function put(budgetId: string, next: Partial<Stacks>) {
  plans.set(budgetId, { ...stacksOf(budgetId), ...next });
  for (const l of listeners) l();
}

const cap = (list: Entry[]) => (list.length > CAP ? list.slice(list.length - CAP) : list);

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getSnapshot = (budgetId: string): Stacks => plans.get(budgetId) ?? EMPTY;

/** The current sequence number: Manage Payees takes it when it opens and counts only later entries. */
export const mark = (): number => seq;

/** Records a write's change set on Undo (ignoring the id already on top) and clears Redo. */
export function recordChange(budgetId: string, changeSetId: string, origin: Origin) {
  const s = stacksOf(budgetId);
  if (s.undo.at(-1)?.changeSetId === changeSetId) return;
  seq += 1;
  put(budgetId, { undo: cap([...s.undo, { changeSetId, origin, seq }]), redo: [] });
}

function allowed(top: Entry | undefined, scope?: Scope): boolean {
  if (!top) return false;
  return !scope || (top.origin === scope.origin && top.seq > scope.since);
}

export function undoState(budgetId: string, scope?: Scope) {
  const s = getSnapshot(budgetId);
  return {
    canUndo: !s.busy && allowed(s.undo.at(-1), scope),
    canRedo: !s.busy && allowed(s.redo.at(-1), scope),
    busy: s.busy,
  };
}

const DROP = new Set([403, 404, 409]);

async function step(
  budgetId: string,
  from: "undo" | "redo",
  scope?: Scope,
): Promise<UndoWhere | undefined> {
  const st = undoState(budgetId, scope);
  if (from === "undo" ? !st.canUndo : !st.canRedo) return undefined;
  const to = from === "undo" ? "redo" : "undo";
  const s = stacksOf(budgetId);
  const entry = s[from].at(-1) as Entry;
  put(budgetId, { [from]: s[from].slice(0, -1), busy: true });
  try {
    const r = await call(budgetId, entry.changeSetId);
    seq += 1;
    const cur = stacksOf(budgetId);
    const pushed: Entry = {
      changeSetId: r.change_set_id,
      origin: entry.origin,
      seq,
      where: r.where,
    };
    put(budgetId, { [to]: cap([...cur[to], pushed]), busy: false });
    return r.where;
  } catch (e) {
    const cur = stacksOf(budgetId);
    if (e instanceof ApiError && DROP.has(e.status)) put(budgetId, { busy: false });
    else put(budgetId, { [from]: [...cur[from], entry], busy: false });
    throw e;
  }
}

/** Undoes the top entry (a scope limits it to entries one surface made). Resolves to `where`, or undefined if idle. */
export const undo = (budgetId: string, scope?: Scope) => step(budgetId, "undo", scope);
/** Redoes the top entry. Its result goes onto Undo without clearing Redo. */
export const redo = (budgetId: string, scope?: Scope) => step(budgetId, "redo", scope);

export function __resetForTests() {
  plans.clear();
  listeners.clear();
  seq = 0;
  call = realUndo;
}
