import { manageGroups, NO_PAYEES, type Payee, unusedIds, unusedLabel } from "@budget/schema/payees";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invalidatePayeeViews, usePayees } from "../api/payees";
import { CloseIcon } from "../shell/icons";
import { useManagePayeesFocus } from "./manage-payees-focus";
import { type GroupKey, PayeeList } from "./manage-payees-list";
import { EditPane } from "./manage-payees-pane";
import { TransactionsPopover } from "./manage-payees-transactions";
import "./manage-payees.css";

/** The plan menu's Manage Payees (and the payee field's footer button): find, rename, hide and delete payees. */
export function ManagePayeesDialog({
  budgetId,
  onClose,
  returnTo,
}: {
  budgetId: string | null;
  onClose: () => void;
  returnTo?: () => HTMLElement | null;
}) {
  const b = budgetId ?? "";
  const qc = useQueryClient();
  const payees = usePayees(b);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<GroupKey, boolean>>({
    payees: true,
    transfers: false,
    hidden: false,
  });
  const [active, setActive] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ payeeId: string; anchor: HTMLElement } | null>(null);
  const popoverRef = useRef(popover);
  popoverRef.current = popover;

  // Fresh counts each time the dialog opens: one refetch of the register's own payee list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    if (b) qc.invalidateQueries({ queryKey: ["payees", b] });
  }, []);

  const all = useMemo<Payee[]>(() => payees.data ?? [], [payees.data]);
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const groups = useMemo(() => manageGroups(all, text), [all, text]);
  const unused = useMemo(() => unusedIds(groups), [groups]);
  const selectedPayees = useMemo(
    () => selected.map((id) => byId.get(id)).filter((p): p is Payee => !!p),
    [selected, byId],
  );
  const selectedSet = useMemo(() => new Set(selectedPayees.map((p) => p.id)), [selectedPayees]);
  const anyHidden = all.some((p) => p.hidden && p.system === null && !p.transfer_account_id);
  const hasAny = all.some((p) => p.system === null);

  const closePopover = useCallback(() => {
    const p = popoverRef.current;
    setPopover(null);
    if (p?.anchor.isConnected) p.anchor.focus();
  }, []);

  useManagePayeesFocus(box, {
    returnTo,
    initial: () => search.current,
    onEscape: (e) => {
      // A rename with unsaved text reverts first (the field handles the key).
      if ((e.target as HTMLElement | null)?.dataset?.dirty !== undefined) return false;
      if (popoverRef.current) closePopover();
      else onClose();
      return true;
    },
  });

  const toggleGroup = (g: GroupKey) => setOpen((o) => ({ ...o, [g]: !o[g] }));
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleGroupAll = (g: GroupKey) => {
    const ids = groups[g].map((p) => p.id);
    setSelected((s) => {
      const have = new Set(s);
      const every = ids.length > 0 && ids.every((id) => have.has(id));
      if (every) return s.filter((id) => !ids.includes(id));
      return [...s, ...ids.filter((id) => !have.has(id))];
    });
  };

  const body = (
    <div
      ref={box}
      className="manage-payees-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-payees-title"
    >
      <div className="mp-head">
        <h2 id="manage-payees-title">Manage Payees</h2>
        <button type="button" className="mp-x" aria-label="Close" onClick={onClose}>
          <CloseIcon width={16} height={16} />
        </button>
      </div>
      <div className="mp-body">
        <div className="mp-left-pane">
          <div className="mp-search">
            <input
              ref={search}
              type="text"
              aria-label="Search Payees"
              placeholder="Search Payees"
              title="Find the payees you're looking for..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {text !== "" ? (
              <button
                type="button"
                className="mp-clear"
                aria-label="Clear search"
                onClick={() => {
                  setText("");
                  search.current?.focus();
                }}
              >
                <CloseIcon width={12} height={12} />
              </button>
            ) : null}
          </div>
          {payees.isSuccess && !hasAny ? (
            <p className="mp-no-payees">{NO_PAYEES}</p>
          ) : (
            <PayeeList
              groups={groups}
              open={open}
              onToggleGroup={toggleGroup}
              selected={selectedSet}
              onSelectOnly={(id) => {
                setSelected([id]);
                setActive(`r-${id}`);
              }}
              onToggle={toggle}
              onToggleGroupAll={toggleGroupAll}
              active={active}
              showHidden={anyHidden}
              onActive={setActive}
            />
          )}
          {unused.length > 0 ? (
            <div className="mp-unused">
              <button type="button" className="mp-link" onClick={() => setSelected(unused)}>
                {unusedLabel(unused.length)}
              </button>
            </div>
          ) : null}
        </div>
        <div className="mp-main">
          <EditPane
            budgetId={b}
            selected={selectedPayees}
            all={all}
            onShowTransactions={(payeeId, anchor) => setPopover({ payeeId, anchor })}
            onDeselectTransfers={() =>
              setSelected((s) => s.filter((id) => !byId.get(id)?.transfer_account_id))
            }
            onClear={() => setSelected([])}
            onOpenGroup={(g) => setOpen((o) => ({ ...o, [g]: true }))}
          />
        </div>
      </div>
      <div className="mp-foot">
        <div className="mp-undo">
          <button
            type="button"
            className="mp-button secondary"
            disabled
            aria-disabled="true"
            data-ticket="EXF-530"
          >
            Undo
          </button>
          <button
            type="button"
            className="mp-button secondary"
            disabled
            aria-disabled="true"
            data-ticket="EXF-530"
          >
            Redo
          </button>
        </div>
        <button type="button" className="mp-button primary" onClick={onClose}>
          Done
        </button>
      </div>
      {popover && box.current ? (
        <TransactionsPopover
          budgetId={b}
          payeeId={popover.payeeId}
          anchor={popover.anchor}
          container={box.current}
          onClose={closePopover}
        />
      ) : null}
    </div>
  );
  // After a fault the list may be stale: keep the list fresh when the dialog is left.
  useEffect(() => () => void (b && invalidatePayeeViews(qc, b)), [b, qc]);
  return createPortal(<div className="mp-backdrop">{body}</div>, document.body);
}
