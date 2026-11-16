import { formatMoney } from "@budget/core/money";
import { selectedTotal } from "@budget/schema/register-selection";
import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";
import type { TransactionDetail } from "@budget/schema/transactions";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

type Row = TransactionDetail & { account_name?: string };

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
  const clear = useCallback(() => {
    dropSelected();
    dropScheduled();
  }, [dropSelected, dropScheduled]);
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
  const { selected, rows } = useSelection();
  const { count, total } = selectedTotal(rows.filter((r) => selected.has(r.id)));
  if (count < 2) return null;
  return (
    <div className="acct-balance acct-selected-total" data-balance="selected">
      <span className={`acct-amount${total < 0 ? " is-negative" : ""}`}>{formatMoney(total)}</span>
      <span className="acct-label">Selected Total ({count})</span>
    </div>
  );
}
