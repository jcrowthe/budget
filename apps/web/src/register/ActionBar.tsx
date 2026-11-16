import type { Account } from "@budget/schema/accounts";
import { exportFileName } from "@budget/schema/register-export";
import {
  barActions,
  countLabel,
  deleteConfirm,
  type SelAccount,
  type SelRow,
} from "@budget/schema/register-selection";
import type { FlagColor } from "@budget/schema/transactions";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccounts } from "../api/accounts";
import { ApiError } from "../api/client";
import { downloadExport, useApproveReject, useBulkTransactions } from "../api/transactions";
import { useSaveUiState, useUiState } from "../api/ui-state";
import { useCurrentPlan } from "../shell/useCurrentPlan";
import { BulkCategorize } from "./BulkCategorize";
import { DeleteDialog, ExportDialog, MemoDialog } from "./BulkDialogs";
import { FlagMenu } from "./FlagMenu";
import { CategorizeIcon, CloseSmallIcon, FlagFilledIcon, MoreDotsIcon } from "./icons";
import { MoreMenu } from "./MoreMenu";
import { useOpenAccounts } from "./openAccounts";
import { useSelection } from "./selection";
import { useRegisterKeys } from "./useRegisterKeys";

type Dialog =
  | null
  | { kind: "memo" }
  | { kind: "export" }
  | { kind: "delete"; title: string; paragraphs: string[] };

/** The register's rect, for the bar's place: fixed, centred over the register, 48px above the window's bottom. */
function useRegisterBox() {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(".register");
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) =>
        b && b.left === r.left && b.width === r.width ? b : { left: r.left, width: r.width },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return box;
}

/**
 * The floating action bar of the selection, its menus and dialogs, and the register's keys. It is always mounted
 * (the keys need it) and draws the bar only while rows are selected.
 */
export function ActionBar({
  budgetId,
  account,
  entryOpen,
  onCategorizeOne,
}: {
  budgetId: string;
  account?: Account;
  entryOpen: boolean;
  /** One selected row: open it in edit mode with the category list open. */
  onCategorizeOne: (id: string) => void;
}) {
  const { selected, rows, set, clear } = useSelection();
  const { plan } = useCurrentPlan();
  const accountsQ = useAccounts(budgetId);
  const { openAccounts } = useOpenAccounts(budgetId);
  const ui = useUiState(budgetId);
  const saveUi = useSaveUiState(budgetId);
  const bulk = useBulkTransactions(budgetId);
  const review = useApproveReject(budgetId);
  const box = useRegisterBox();
  const [menu, setMenu] = useState<null | "more" | "flag" | "categorize">(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const flagBtn = useRef<HTMLButtonElement>(null);
  const catBtn = useRef<HTMLButtonElement>(null);

  const sel = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const ids = sel.map((r) => r.id);
  const accountById = useMemo(() => {
    const m = new Map<string, SelAccount>();
    for (const a of accountsQ.data ?? []) {
      m.set(a.id, { id: a.id, type: a.type, on_budget: a.on_budget, closed: a.closed });
    }
    return m;
  }, [accountsQ.data]);
  const actions = barActions(sel, (id) => accountById.get(id) ?? null, account ? "account" : "all");
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const otherReconciled = (r: Pick<SelRow, "transfer_transaction_id">) =>
    r.transfer_transaction_id !== null &&
    byId.get(r.transfer_transaction_id)?.cleared === "reconciled";

  const guard = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
      return false;
    }
  };
  const close = () => setMenu(null);

  const doClear = () => {
    if (!actions.clear) return;
    close();
    void guard(() => bulk.mutateAsync({ op: actions.clear as "clear" | "unclear", ids }));
  };
  const doCategorize = () => {
    if (!actions.categorize) return;
    close();
    const one = sel[0];
    if (sel.length === 1 && one) onCategorizeOne(one.id);
    else setMenu("categorize");
  };
  const doApprove = () => {
    if (!actions.approve) return;
    close();
    void guard(() =>
      review.mutateAsync({
        action: "approve",
        ids: sel.filter((r) => !r.approved).map((r) => r.id),
      }),
    );
  };
  const doReject = () => {
    if (!actions.reject) return;
    close();
    void guard(async () => {
      await review.mutateAsync({ action: "reject", ids });
      clear();
    });
  };
  const doDuplicate = () => {
    close();
    void guard(async () => {
      const r = await bulk.mutateAsync({ op: "duplicate", ids });
      set(r.copies.map((c) => c.copy_id));
    });
  };
  const doFlag = (color: FlagColor | null) => {
    close();
    void guard(() => bulk.mutateAsync({ op: "flag", ids, value: color }));
  };
  const doMemo = (memo: string) => {
    setDialog(null);
    void guard(() => bulk.mutateAsync({ op: "memo", ids, value: memo }));
  };
  const doMove = (accountId: string) => {
    close();
    void guard(() => bulk.mutateAsync({ op: "move", ids, value: accountId }));
  };
  const doExport = () => {
    setDialog(null);
    void guard(() =>
      downloadExport(budgetId, ids, exportFileName(plan?.name ?? "Plan", new Date(), "local")),
    );
  };
  const askExport = () => {
    close();
    if (ui.data?.hide_register_export_dialog) doExport();
    else setDialog({ kind: "export" });
  };
  const sendDelete = async (confirm: boolean) => {
    setDialog(null);
    setError(null);
    try {
      await bulk.mutateAsync(
        confirm ? { op: "delete", ids, confirm_reconciled: true } : { op: "delete", ids },
      );
      clear();
    } catch (e) {
      if (e instanceof ApiError && e.errorName === "transaction_reconciled" && !confirm) {
        const c = deleteConfirm(sel, otherReconciled, true);
        if (c) {
          setDialog({ kind: "delete", ...c });
          return;
        }
      }
      setError(e instanceof Error ? e.message : "That did not work");
    }
  };
  const askDelete = () => {
    close();
    const c = deleteConfirm(sel, otherReconciled);
    if (c) setDialog({ kind: "delete", ...c });
    else void sendDelete(false);
  };

  useRegisterKeys({
    hasSelection: sel.length > 0,
    entryOpen,
    selectAll: () => set(rows.map((r) => r.id)),
    clearSelection: () => {
      setError(null);
      clear();
    },
    clear: actions.clear === "clear" ? doClear : actions.clear === "unclear" ? doClear : undefined,
    categorize: actions.categorize ? doCategorize : undefined,
    approve: actions.approve ? doApprove : undefined,
    reject: actions.reject ? doReject : undefined,
    duplicate: doDuplicate,
    flag: () => {
      close();
      setMenu("flag");
    },
    del: askDelete,
  });

  const showBar = sel.length > 0;
  return (
    <>
      {showBar && box
        ? createPortal(
            <div
              className="register-action-bar-container"
              style={{ left: box.left, width: box.width }}
            >
              {error ? (
                <div className="register-action-bar-error" role="alert">
                  {error}
                </div>
              ) : null}
              <div
                className="register-action-bar-inner"
                role="toolbar"
                aria-label="Selection actions"
              >
                <button
                  type="button"
                  className="action-bar-button action-bar-uncheck"
                  title="Deselect all"
                  onClick={() => {
                    setError(null);
                    clear();
                  }}
                >
                  <CloseSmallIcon />
                  {countLabel(sel.length)}
                </button>
                <hr />
                {actions.approve && (
                  <button
                    type="button"
                    className="action-bar-button"
                    title="Approve (A)"
                    onClick={doApprove}
                  >
                    Approve
                  </button>
                )}
                {actions.reject && (
                  <button
                    type="button"
                    className="action-bar-button"
                    title="Reject (shift+R)"
                    onClick={doReject}
                  >
                    Reject
                  </button>
                )}
                {actions.categorize && (
                  <button
                    ref={catBtn}
                    type="button"
                    className="action-bar-button"
                    title="Categorize (K)"
                    onClick={() => (menu === "categorize" ? close() : doCategorize())}
                  >
                    <CategorizeIcon />
                    Categorize
                  </button>
                )}
                <button
                  ref={flagBtn}
                  type="button"
                  className="action-bar-button"
                  title="Flag (shift+F, then 0-6)"
                  aria-haspopup="menu"
                  onClick={() => setMenu((m) => (m === "flag" ? null : "flag"))}
                >
                  <FlagFilledIcon />
                  Flag
                </button>
                {actions.clear === "clear" && (
                  <button
                    type="button"
                    className="action-bar-button"
                    title="Toggle cleared state"
                    onClick={doClear}
                  >
                    Clear
                  </button>
                )}
                <hr />
                <button
                  ref={moreBtn}
                  type="button"
                  className="action-bar-button"
                  aria-haspopup="menu"
                  onClick={() => setMenu((m) => (m === "more" ? null : "more"))}
                >
                  <MoreDotsIcon />
                  More
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
      {showBar && menu === "more" && moreBtn.current ? (
        <MoreMenu
          anchor={moreBtn.current}
          count={sel.length}
          unclear={actions.clear === "unclear"}
          oneRow={actions.makeRepeating}
          moveTo={
            actions.move
              ? openAccounts
                  .filter((a) => a.id !== account?.id)
                  .map((a) => ({ id: a.id, name: a.name }))
              : null
          }
          onClose={close}
          onUnclear={doClear}
          onDuplicate={doDuplicate}
          onMemo={() => {
            close();
            setDialog({ kind: "memo" });
          }}
          onMove={doMove}
          onExport={askExport}
          onDelete={askDelete}
        />
      ) : null}
      {showBar && menu === "flag" && flagBtn.current ? (
        <FlagMenu
          anchor={flagBtn.current}
          placement="above"
          flagged={actions.anyFlagged}
          onClose={close}
          onPick={doFlag}
        />
      ) : null}
      {showBar && menu === "categorize" && catBtn.current ? (
        <BulkCategorize
          anchor={catBtn.current}
          budgetId={budgetId}
          onClose={close}
          onPick={(value) => {
            close();
            void guard(() => bulk.mutateAsync({ op: "categorize", ids, value }));
          }}
        />
      ) : null}
      {showBar && dialog?.kind === "memo" ? (
        <MemoDialog count={sel.length} onCancel={() => setDialog(null)} onUpdate={doMemo} />
      ) : null}
      {showBar && dialog?.kind === "export" ? (
        <ExportDialog
          onCancel={() => setDialog(null)}
          onExport={(dont) => {
            if (dont) saveUi.mutate({ hide_register_export_dialog: true });
            doExport();
          }}
        />
      ) : null}
      {showBar && dialog?.kind === "delete" ? (
        <DeleteDialog
          title={dialog.title}
          paragraphs={dialog.paragraphs}
          onCancel={() => setDialog(null)}
          onDelete={() => void sendDelete(true)}
        />
      ) : null}
    </>
  );
}
