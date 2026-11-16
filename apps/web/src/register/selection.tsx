import { formatMoney } from "@budget/core/money";
import { selectedTotal } from "@budget/schema/register-selection";
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
};

const Ctx = createContext<Selection | null>(null);

/** The register's selection, shared by the header (Selected Total) and the register (rows, bar, keys). */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rows, setRowsState] = useState<readonly Row[]>([]);
  const last = useRef<readonly Row[]>(rows);
  const set = useCallback((ids: Iterable<string>) => setSelected(new Set(ids)), []);
  const toggle = useCallback(
    (id: string) =>
      setSelected((s) => {
        const n = new Set(s);
        if (!n.delete(id)) n.add(id);
        return n;
      }),
    [],
  );
  const clear = useCallback(() => setSelected((s) => (s.size === 0 ? s : new Set())), []);
  const setRows = useCallback((next: readonly Row[]) => {
    if (last.current === next) return;
    last.current = next;
    setRowsState(next);
  }, []);
  const value = useMemo(
    () => ({ selected, set, toggle, clear, rows, setRows }),
    [selected, set, toggle, clear, rows, setRows],
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
