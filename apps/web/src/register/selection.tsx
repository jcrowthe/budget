import { rangeIds, selectedTotal } from "@budget/schema/register-selection";
import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";

import type { TransactionDetail } from "@budget/schema/transactions";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { scheduledRowKey } from "./scheduledKeys";

type Row = TransactionDetail & { account_name?: string };

type List = "real" | "scheduled";
export type PickHow = "toggle" | "only" | "rangeAdd" | "rangeOnly";

type Selection = {
  selected: ReadonlySet<string>;
  set: (ids: Iterable<string>) => void;
  toggle: (id: string) => void;
  clear: () => void;
  /** The register's rows in display order, published by the table. */
  rows: readonly Row[];
  setRows: (rows: readonly Row[]) => void;
  /** Selected scheduled rows: never together with real rows (selecting one kind clears the other). */
  scheduled: ReadonlySet<string>;
  setScheduled: (ids: Iterable<string>) => void;
  toggleScheduled: (id: string) => void;
  scheduledRows: readonly ScheduledTransaction[];
  setScheduledRows: (rows: readonly ScheduledTransaction[]) => void;
  /** The last row clicked, ticked or unticked without Shift (EXF-635); ranges grow from it. */
  anchor: { list: List; id: string } | null;
  /** A click on a row or its box. The range kinds fall back to `toggle`/`only` with no usable anchor. */
  pick: (list: List, id: string, how: PickHow) => void;
  /** Shift+arrow: moves the cursor one row and selects anchor…cursor. Returns the cursor's id. */
  extend: (step: 1 | -1) => string | null;
  /** A right-click opened the More menu at this point (EXF-503); null when no context menu is open. */
  menuAt: { x: number; y: number; key: number } | null;
  openMenuAt: (x: number, y: number) => void;
  closeMenuAt: () => void;
};

const Ctx = createContext<Selection | null>(null);

/** The register's selection, shared by the header (Selected Total) and the register (rows, bar, keys). */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [scheduled, setScheduledState] = useState<ReadonlySet<string>>(new Set());
  const [rows, setRowsState] = useState<readonly Row[]>([]);
  const [scheduledRows, setScheduledRowsState] = useState<readonly ScheduledTransaction[]>([]);
  const last = useRef<readonly Row[]>(rows);
  const lastScheduled = useRef<readonly ScheduledTransaction[]>(scheduledRows);
  const dropScheduled = useCallback(
    () => setScheduledState((s) => (s.size === 0 ? s : new Set())),
    [],
  );
  const dropSelected = useCallback(() => setSelected((s) => (s.size === 0 ? s : new Set())), []);
  const set = useCallback(
    (ids: Iterable<string>) => {
      const next = new Set(ids);
      if (next.size > 0) dropScheduled();
      setSelected(next);
    },
    [dropScheduled],
  );
  const toggle = useCallback(
    (id: string) => {
      dropScheduled();
      setSelected((s) => {
        const n = new Set(s);
        if (!n.delete(id)) n.add(id);
        return n;
      });
    },
    [dropScheduled],
  );
  const setScheduled = useCallback(
    (ids: Iterable<string>) => {
      const next = new Set(ids);
      if (next.size > 0) dropSelected();
      setScheduledState(next);
    },
    [dropSelected],
  );
  const toggleScheduled = useCallback(
    (id: string) => {
      dropSelected();
      setScheduledState((s) => {
        const n = new Set(s);
        if (!n.delete(id)) n.add(id);
        return n;
      });
    },
    [dropSelected],
  );
  const [anchor, setAnchor] = useState<{ list: List; id: string } | null>(null);
  const anchorRef = useRef<{ list: List; id: string } | null>(null);
  const cursorRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const scheduledSelRef = useRef(scheduled);
  scheduledSelRef.current = scheduled;
  const rowsRef = useRef<readonly Row[]>(rows);
  rowsRef.current = rows;
  const scheduledRowsRef = useRef<readonly ScheduledTransaction[]>(scheduledRows);
  scheduledRowsRef.current = scheduledRows;
  const moveAnchor = useCallback((next: { list: List; id: string } | null) => {
    anchorRef.current = next;
    cursorRef.current = null;
    setAnchor(next);
  }, []);
  const orderOf = useCallback(
    (list: List): string[] =>
      list === "real"
        ? rowsRef.current.map((r) => r.id)
        : scheduledRowsRef.current.map(scheduledRowKey),
    [],
  );
  const apply = useCallback(
    (list: List, ids: Iterable<string>) => (list === "real" ? set(ids) : setScheduled(ids)),
    [set, setScheduled],
  );
  const pick = useCallback(
    (list: List, id: string, how: PickHow) => {
      const a = anchorRef.current;
      const range = (how === "rangeAdd" || how === "rangeOnly") && a && a.list === list;
      const ids = range ? rangeIds(orderOf(list), a.id, id) : null;
      if (ids) {
        const base =
          how === "rangeAdd" ? (list === "real" ? selectedRef : scheduledSelRef).current : [];
        apply(list, [...base, ...ids]);
        cursorRef.current = null;
        return;
      }
      if (how === "toggle" || how === "rangeAdd") (list === "real" ? toggle : toggleScheduled)(id);
      else apply(list, [id]);
      moveAnchor({ list, id });
    },
    [apply, moveAnchor, orderOf, toggle, toggleScheduled],
  );
  const extend = useCallback(
    (step: 1 | -1) => {
      const a = anchorRef.current;
      if (!a) return null;
      const order = orderOf(a.list);
      const at = order.indexOf(cursorRef.current ?? a.id);
      if (at < 0) return null;
      const next = Math.min(order.length - 1, Math.max(0, at + step));
      const cursor = order[next] as string;
      cursorRef.current = cursor;
      apply(a.list, rangeIds(order, a.id, cursor) ?? [a.id]);
      return cursor;
    },
    [apply, orderOf],
  );
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; key: number } | null>(null);
  const menuKey = useRef(0);
  const openMenuAt = useCallback((x: number, y: number) => {
    setMenuAt({ x, y, key: ++menuKey.current });
  }, []);
  const closeMenuAt = useCallback(() => setMenuAt(null), []);
  // The menu belongs to a selection: it closes when nothing is selected.
  const nothingSelected = selected.size === 0 && scheduled.size === 0;
  useEffect(() => {
    if (nothingSelected) setMenuAt(null);
  }, [nothingSelected]);
  const clear = useCallback(() => {
    dropSelected();
    dropScheduled();
    moveAnchor(null);
  }, [dropSelected, dropScheduled, moveAnchor]);
  const setScheduledRows = useCallback((next: readonly ScheduledTransaction[]) => {
    if (lastScheduled.current === next) return;
    lastScheduled.current = next;
    setScheduledRowsState(next);
  }, []);
  const setRows = useCallback((next: readonly Row[]) => {
    if (last.current === next) return;
    last.current = next;
    setRowsState(next);
  }, []);
  const value = useMemo(
    () => ({
      selected,
      set,
      toggle,
      clear,
      rows,
      setRows,
      scheduled,
      setScheduled,
      toggleScheduled,
      scheduledRows,
      setScheduledRows,
      anchor,
      pick,
      extend,
      menuAt,
      openMenuAt,
      closeMenuAt,
    }),
    [
      selected,
      set,
      toggle,
      clear,
      rows,
      setRows,
      scheduled,
      setScheduled,
      toggleScheduled,
      scheduledRows,
      setScheduledRows,
      anchor,
      pick,
      extend,
      menuAt,
      openMenuAt,
      closeMenuAt,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): Selection {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSelection needs a SelectionProvider");
  return v;
}

/** "$245.50" over "Selected Total (2)": nothing below two rows. */
export function SelectedTotal() {
  const fmt = usePlanFormatter();
  const { selected, rows } = useSelection();
  const { count, total } = selectedTotal(rows.filter((r) => selected.has(r.id)));
  if (count < 2) return null;
  return (
    <div className="acct-balance acct-selected-total" data-balance="selected">
      <span className={`acct-amount${total < 0 ? " is-negative" : ""}`}>{fmt.money(total)}</span>
      <span className="acct-label">Selected Total ({count})</span>
    </div>
  );
}
