import type { Account } from "@budget/schema/accounts";
import { ATTENTION_FILTER_LABEL } from "@budget/schema/attention";
import { isCredit } from "@budget/schema/card-payments";
import type { UndoWhere } from "@budget/schema/changes";
import { useIsMutating } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { usePaymentAvailable } from "../account/usePaymentAvailable";
import { ApiError } from "../api/client";
import { accountPath, planPath } from "../shell/planPaths";
import { useShortcut } from "../shortcuts/dispatcher";
import { useUndo } from "../undo/useUndo";
import { ActionBar } from "./ActionBar";
import { useAttentionFilter } from "./attention-filter";
import type { Open } from "./entryDraft";
import { CloseSmallIcon } from "./icons";
import { useOpenAccounts } from "./openAccounts";
import { ReconcileBar } from "./ReconcileBar";
import { RegisterTable } from "./RegisterTable";
import { RegisterToolbar } from "./RegisterToolbar";
import { RegisterViewContext, useRegisterViewState } from "./register-view";
import { useSelection } from "./selection";
import "./register.css";
import "./entry.css";

const isTyping = (t: EventTarget | null) => {
  const el = t instanceof HTMLElement ? t : null;
  return !!el && (el.closest("input,textarea,select") !== null || el.isContentEditable);
};

/** One account's register, or (without `account`) every account's: All Accounts. */
export function Register({ budgetId, account }: { budgetId: string; account?: Account }) {
  const [open, setOpen] = useState<Open>(null);
  const attention = useAttentionFilter();
  const view = useRegisterViewState(budgetId, account?.id);
  const { selected, scheduled } = useSelection();
  const { openAccounts, loaded } = useOpenAccounts(budgetId);
  // A closed account, or All Accounts with no open account, takes no new transaction.
  const closed = account ? account.closed : loaded && openAccounts.length === 0;
  const openAdd = useCallback((date?: string) => {
    setOpen({ mode: "add", key: Date.now() + Math.random(), date });
  }, []);

  // EXF-539: Record Payment opens a new row dated today with Inflow set to the payment Available (D2).
  const credit = !!account && isCredit(account.type);
  const pay = usePaymentAvailable(budgetId, account?.id ?? "", credit);
  const openPayment = () =>
    setOpen({
      mode: "add",
      key: Date.now() + Math.random(),
      payment: { inflow: pay.available ?? null },
    });
  // `?record-payment` (the Plan page's button) opens that row once, then drops the parameter (D7).
  const [params, setParams] = useSearchParams();
  const wantsPayment = params.has("record-payment");
  const handled = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the account and its month are there
  useEffect(() => {
    if (!wantsPayment || handled.current) return;
    // All Accounts has no account: only drop the parameter.
    if (account && credit && !account.closed) {
      if (!pay.settled) return;
      openPayment();
    }
    handled.current = true;
    const next = new URLSearchParams(params);
    next.delete("record-payment");
    setParams(next, { replace: true });
  }, [wantsPayment, account, credit, pay.settled]);

  // EXF-530: Undo and Redo act on the plan's shared stack. A request in flight has not recorded its change set yet,
  // and an open entry row holds edits the undo would not know about: both disable Undo.
  const u = useUndo(budgetId);
  const mutating = useIsMutating();
  const navigate = useNavigate();
  const location = useLocation();
  const { set: selectRows, clear: clearRows } = useSelection();
  const [notice, setNotice] = useState<string | null>(null);
  const undoEnabled = u.canUndo && open === null && mutating === 0;
  const redoEnabled = u.canRedo && mutating === 0;
  // Follows the engine's `where` (D6): the account of the change, with its rows selected.
  const go = (where: UndoWhere) => {
    if (where.surface === "plan") {
      navigate(planPath(budgetId, where.month ?? undefined));
      return;
    }
    if (where.surface !== "register") return;
    const ids = where.transaction_ids;
    if (ids.length === 0) {
      clearRows();
      return;
    }
    if (account && account.id !== where.account_id) {
      navigate(accountPath(budgetId, where.account_id), { state: { select: ids } });
    } else {
      // Same page (or All Accounts): a new location key makes the table select the rows.
      navigate(location.pathname + location.search, { replace: true, state: { select: ids } });
      if (!account) selectRows(ids);
    }
  };
  const step = async (kind: "undo" | "redo") => {
    setNotice(null);
    try {
      const where = await (kind === "undo" ? u.undo() : u.redo());
      if (where) go(where);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.detail : kind === "undo" ? "Undo failed" : "Redo failed");
    }
  };
  useShortcut("undo", () => {
    if (undoEnabled) void step("undo");
  });
  useShortcut("redo", () => {
    if (redoEnabled) void step("redo");
  });

  // Shift+N adds a transaction unless the user is typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "N" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented)
        return;
      if (closed) return;
      if (isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      openAdd();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openAdd, closed]);

  return (
    <RegisterViewContext.Provider value={view}>
      <section
        className={`register${selected.size > 0 || scheduled.size > 0 ? " has-actionbar" : ""}`}
        aria-label="Register"
      >
        <RegisterToolbar
          name={account?.name ?? "All Accounts"}
          onAdd={() => openAdd()}
          closed={closed}
          closedAccount={!!account?.closed}
          onRecordPayment={credit ? openPayment : undefined}
          paymentDisabled={!account || account.closed || !pay.settled}
          viewScope={account ? "account" : "all"}
          undo={{ enabled: undoEnabled, onClick: () => void step("undo") }}
          redo={{ enabled: redoEnabled, onClick: () => void step("redo") }}
        />
        {notice !== null && (
          // The notice style is the floating bar's; inset it to the toolbar's 16px edge so its corners read in the page.
          <div
            className="register-action-bar-error"
            role="alert"
            data-undo-notice
            style={{ margin: "0 var(--space-3) var(--space-2)" }}
          >
            {notice}
          </div>
        )}
        <ReconcileBar />
        {attention.on && (
          <div className="attention-filter-row">
            <button
              type="button"
              className="attention-chip"
              aria-label={`Remove filter: ${ATTENTION_FILTER_LABEL}`}
              onClick={() => attention.setOn(false)}
            >
              <span>{ATTENTION_FILTER_LABEL}</span>
              <CloseSmallIcon />
            </button>
          </div>
        )}
        <RegisterTable
          budgetId={budgetId}
          account={account}
          open={open}
          onOpen={setOpen}
          onCloseEntry={() => setOpen(null)}
          onSaved={(next, date) => (next === "again" ? openAdd(date) : setOpen(null))}
        />
        <ActionBar
          budgetId={budgetId}
          account={account}
          entryOpen={open !== null}
          onCategorizeOne={(id) =>
            setOpen({ mode: "edit", id, focus: "category", openCategory: true })
          }
        />
      </section>
    </RegisterViewContext.Provider>
  );
}
