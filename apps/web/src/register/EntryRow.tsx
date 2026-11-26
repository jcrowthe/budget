import type { Account } from "@budget/schema/accounts";
import { paymentDisplay, transferEntryLabel } from "@budget/schema/card-payments";
import type { Payee } from "@budget/schema/payees";
import { savesAsScheduled } from "@budget/schema/recurrence";
import {
  EDIT_NOT_SCHEDULED,
  type ScheduledTransaction,
} from "@budget/schema/scheduled-transactions";
import { autoDistribute, splitSum } from "@budget/schema/split";
import type {
  EnterNowRequest,
  TransactionCreateRequest,
  TransactionDetail,
  TransactionUpdateRequest,
} from "@budget/schema/transactions";
import { transferCategoryRule } from "@budget/schema/transfers";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccounts } from "../api/accounts";
import { startPlanSync } from "../api/bank-link";
import { ApiError } from "../api/client";
import { useMonth } from "../api/months";
import { usePayees } from "../api/payees";
import { useCreateScheduled, useUpdateScheduled } from "../api/scheduledTransactions";
import { useEnterPending, useSaveTransaction } from "../api/transactions";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { AccountField } from "./AccountField";
import { AmountField } from "./AmountField";
import { useAttentionColumn } from "./attention-filter";
import { Box } from "./Box";
import { ClosedAccountSaveDialog, ReconciledSaveDialog } from "./BulkDialogs";
import { CategoryField } from "./CategoryField";
import { DateField } from "./DateField";
import {
  amountTexts,
  type Draft,
  draftAmount,
  draftError,
  draftFromScheduled,
  draftFromTx,
  draftToCreate,
  draftToPatch,
  draftToScheduledCreate,
  draftToScheduledPatch,
  emptyDraft,
  emptyLine,
  type Field,
  type LineDraft,
  lineAmount,
  rememberedCategory,
  touchesLocked,
} from "./entryDraft";
import { localToday } from "./format";
import { ClearedFilledIcon, ClearedOutlineIcon, LockIcon } from "./icons";
import { startMoved } from "./import-start";
import { PayeeField } from "./PayeeField";
import { useRegisterView } from "./register-view";
import { SplitDialog } from "./SplitDialog";
import { SplitLines } from "./SplitLines";

const LOCK_TITLE = "A credit account's Starting Balance keeps its payee and category.";

/** The inline add and edit row (EXF-517): the fields, then Cancel, Save and Save and add another. */
type PendingSave = {
  next: "close" | "again";
  body: TransactionCreateRequest | TransactionUpdateRequest;
  iso: string;
};

export function EntryRow({
  budgetId,
  mode,
  tx,
  scheduled,
  account,
  accounts,
  plan,
  showCategory,
  lockStart,
  date,
  initialFocus,
  prefillInflow,
  prefill,
  openCategory,
  startSplit,
  onClose,
  onSaved,
}: {
  budgetId: string;
  mode: "add" | "edit" | "editScheduled" | "editPending";
  tx?: TransactionDetail;
  /** The series being edited (mode "editScheduled"). */
  scheduled?: ScheduledTransaction;
  /** The register's own account; absent on All Accounts. */
  account?: Account;
  /** Open accounts in sidebar order (All Accounts' account field). */
  accounts: Account[];
  plan: boolean;
  showCategory: boolean;
  lockStart?: boolean;
  /** The date a new row starts with (ISO); today when absent. */
  date?: string;
  initialFocus: Field;
  /** Record Payment: the Inflow text a new row starts with. */
  prefillInflow?: string;
  /** Make Repeating: the whole first draft of the new row. */
  prefill?: Draft;
  openCategory?: boolean;
  /** Open with two empty lines (the S key). */
  startSplit?: boolean;
  onClose: () => void;
  onSaved: (next: "close" | "again", date: string) => void;
}) {
  const today = localToday();
  const fmt = usePlanFormatter();
  const [draft, setDraft] = useState<Draft>(() => {
    const d = scheduled
      ? draftFromScheduled(scheduled, fmt)
      : tx
        ? draftFromTx(tx, fmt)
        : (prefill ?? {
            ...emptyDraft(date ?? today, account?.id ?? null, fmt),
            inflowText: prefillInflow ?? "",
          });
    // S on a row: the old category is not carried over.
    return startSplit && !d.lines
      ? { ...d, category: { kind: "none" }, lines: [emptyLine(), emptyLine()] }
      : d;
  });
  const [message, setMessage] = useState<string | null>(null);
  const [unbalanced, setUnbalanced] = useState<{
    total: number;
    sum: number;
    next: "close" | "again";
  } | null>(null);
  const [askReconciled, setAskReconciled] = useState<PendingSave | null>(null);
  const [askClosed, setAskClosed] = useState<PendingSave | null>(null);
  const [lineFocus, setLineFocus] = useState<{ line: number; n: number } | null>(null);
  const qc = useQueryClient();
  const accountsQ = useAccounts(budgetId);
  const rows = useRef<HTMLTableSectionElement>(null);
  // Set synchronously, so two key events in one tick cannot both start a save.
  const saving = useRef(false);
  const payeesQ = usePayees(budgetId);
  const save = useSaveTransaction(budgetId);
  const enterNow = useEnterPending(budgetId);
  const isPendingEdit = mode === "editPending";
  const createScheduled = useCreateScheduled(budgetId);
  const updateScheduled = useUpdateScheduled(budgetId);
  const isScheduledEdit = mode === "editScheduled";
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const monthOf = `${(draft.lastDate || today).slice(0, 7)}-01`;
  const monthQ = useMonth(budgetId, monthOf);
  const chosen = account ?? (accountsQ.data ?? accounts).find((a) => a.id === draft.accountId);
  const transferAccount = draft.transferAccountId
    ? (accountsQ.data ?? accounts).find((a) => a.id === draft.transferAccountId)
    : undefined;
  // One rule decides: a tracking side never has a category, an on-plan to on-plan transfer needs none.
  const rule = transferCategoryRule(
    { on_budget: chosen ? chosen.on_budget : true },
    transferAccount ? { on_budget: transferAccount.on_budget } : null,
  );
  const noCategory = rule !== "category";
  // D3/D4: a card's payments read as such: the payee list says "Payment from <account>", the category is fixed.
  const pay = chosen && transferAccount ? paymentDisplay(chosen, transferAccount) : null;
  const allAccounts = accountsQ.data ?? accounts;
  const transferLabel = (p: Payee) => {
    const other = allAccounts.find((a) => a.id === p.transfer_account_id);
    return other
      ? transferEntryLabel(chosen ?? null, other)
      : `To/From ${p.name.replace(/^Transfer : /, "")}`;
  };
  const payeeShown =
    transferAccount && pay?.cardIsSide && chosen
      ? { id: null, name: transferEntryLabel(chosen, transferAccount) }
      : draft.payee;
  const isSplit = draft.lines !== null;
  const patchLine = (i: number, p: Partial<LineDraft>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines ? d.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) : d.lines,
    }));
  const startSplitting = () =>
    setDraft((d) => ({ ...d, category: { kind: "none" }, lines: [emptyLine(), emptyLine()] }));
  const addLine = () => {
    setDraft((d) => ({ ...d, lines: [...(d.lines ?? []), emptyLine()] }));
    setLineFocus((f) => ({ line: draft.lines?.length ?? 0, n: (f?.n ?? 0) + 1 }));
  };
  const removeLine = (i: number) =>
    setDraft((d) => {
      const lines = (d.lines ?? []).filter((_, j) => j !== i);
      // Removing the last line leaves split mode.
      return { ...d, lines: lines.length === 0 ? null : lines };
    });

  const focusField = (f: Field) => {
    const el = rows.current?.querySelector<HTMLElement>(`[data-field="${f}"] input`);
    el?.focus();
  };
  const focusLine = (line: number) =>
    rows.current
      ?.querySelector<HTMLElement>(`[data-line="${line}"][data-field="payee"] input`)
      ?.focus();
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, when the row opens
  useEffect(() => {
    // Source: after S the memo of the parent row has focus, no list open.
    if (startSplit) focusField("memo");
    else focusField(initialFocus);
  }, []);
  // The split just started (or a line was added): focus the new line's payee once it is drawn.
  const hadLines = useRef(isSplit);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when split mode starts
  useEffect(() => {
    if (isSplit && !hadLines.current) focusField("memo");
    hadLines.current = isSplit;
  }, [isSplit]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when a line is added
  useEffect(() => {
    if (lineFocus) focusLine(lineFocus.line);
  }, [lineFocus?.n]);

  const submit = (next: "close" | "again", override?: Draft) => {
    if (saving.current) return;
    const d0 = override ?? draft;
    // A category the rule does not allow is never sent.
    const d: Draft = noCategory ? { ...d0, category: { kind: "none" } } : d0;
    const err = draftError(d, today, plan, fmt);
    if (err) {
      setMessage(err.message);
      focusField(err.field);
      return;
    }
    if (d.lines) {
      if (d.lines.length < 2) {
        setMessage("A split needs at least two lines.");
        return;
      }
      const total = draftAmount(d, fmt);
      const sum = splitSum(d.lines.map((l) => lineAmount(l, fmt)));
      if (sum !== total) {
        setMessage(null);
        setUnbalanced({ total, sum, next });
        return;
      }
    }
    setMessage(null);
    const accountId = account?.id ?? (d.accountId as string);
    const typedDate = fmt.parseDate(d.dateText, today) as string;
    if (mode === "add" && savesAsScheduled(typedDate, d.frequency, today)) {
      // The same rule as the API: a future date or a repeat is a schedule.
      saving.current = true;
      createScheduled.mutate(draftToScheduledCreate(d, accountId, today, fmt), {
        onSuccess: () => onSaved(next, typedDate),
        onError: (e) => setMessage(`Couldn't save the transaction. ${e.message}`),
        onSettled: () => {
          saving.current = false;
        },
      });
      return;
    }
    if (isScheduledEdit && scheduled) {
      const body = draftToScheduledPatch(scheduled, d, today, fmt);
      if (body.date_first && typedDate <= today && d.frequency === "never") {
        setMessage(EDIT_NOT_SCHEDULED);
        return;
      }
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      saving.current = true;
      updateScheduled.mutate(
        { id: scheduled.id, body },
        {
          onSuccess: () => onSaved(next, typedDate),
          onError: (e) => setMessage(`Couldn't save the transaction. ${e.message}`),
          onSettled: () => {
            saving.current = false;
          },
        },
      );
      return;
    }
    if (isPendingEdit && tx) {
      // Any edit of a pending bank transaction enters it: one request, what changed in its body.
      const { account_id: _account, ...diff } = draftToPatch(tx, d, today, fmt);
      saving.current = true;
      enterNow.mutate(
        { id: tx.id, body: diff as EnterNowRequest },
        {
          onSuccess: () => onSaved(next, typedDate),
          onError: (e) => setMessage(`Couldn't enter the transaction. ${e.message}`),
          onSettled: () => {
            saving.current = false;
          },
        },
      );
      return;
    }
    const body =
      mode === "edit" && tx
        ? draftToPatch(tx, d, today, fmt)
        : draftToCreate(d, accountId, today, fmt);
    // "Approve" on an unedited unapproved row still saves: the Worker approves on any PATCH (EXF-531).
    if (mode === "edit" && tx && !tx.approved && Object.keys(body).length === 0) {
      Object.assign(body, { approved: true });
    }
    if (mode === "edit" && Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const iso = (body as { date?: string }).date ?? d.lastDate;
    // A closed account's row asks before any edit is saved (EXF-721); then the reconciled check follows.
    if (mode === "edit" && account?.closed) {
      setAskClosed({ next, body, iso });
      return;
    }
    afterClosedCheck({ next, body, iso });
  };
  const needsReconciledAsk = (p: PendingSave) =>
    mode === "edit" && tx?.cleared === "reconciled" && touchesLocked(p.body);
  const afterClosedCheck = (p: PendingSave) => {
    // A reconciled row asks before an amount, date or account change is saved (EXF-533).
    if (needsReconciledAsk(p)) {
      setAskReconciled(p);
      return;
    }
    send(p, false);
  };
  const send = (p: PendingSave, confirmed: boolean) => {
    saving.current = true;
    save.mutate(
      {
        id: mode === "edit" ? tx?.id : undefined,
        body: confirmed ? { ...p.body, confirm_reconciled: true } : p.body,
      },
      {
        onSuccess: () => {
          // A linked Starting Balance moved: the server moved the import start, so the next sync re-reads.
          if (mode === "edit" && tx && startMoved(tx, p.body, chosen)) startPlanSync(qc, budgetId);
          onSaved(p.next, p.iso);
        },
        onError: (e) => {
          // A transfer's reconciled other side answers 409 the same way: ask, then resend confirmed.
          if (!confirmed && e instanceof ApiError && e.errorName === "transaction_reconciled") {
            setAskReconciled(p);
            return;
          }
          setMessage(`Couldn't save the transaction. ${e.message}`);
        },
        onSettled: () => {
          saving.current = false;
        },
      },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement && !e.defaultPrevented) {
      e.preventDefault();
      submit(mode === "add" ? "again" : "close");
    }
  };

  const fillCategory = (p: Payee) => {
    const c = rememberedCategory(p);
    if (draft.category.kind === "none" && c && !noCategory) patch({ category: c });
  };

  const { showFlags, showBalance } = useRegisterView();
  const attentionCol = useAttentionColumn();
  const colCount =
    (plan ? 1 : 0) +
    (showCategory ? 1 : 0) +
    (attentionCol ? 7 : 6) +
    (showFlags ? 1 : 0) +
    (showBalance ? 1 : 0);
  const parentAmount = draftAmount(draft, fmt);

  const autoDistributeLines = () => {
    if (!draft.lines || !unbalanced) return;
    const spread = autoDistribute(
      unbalanced.total,
      draft.lines.map((l) => lineAmount(l, fmt)),
      fmt.digits,
    );
    setDraft((d) => ({
      ...d,
      lines: (d.lines ?? []).map((l, i) => ({ ...l, ...amountTexts(spread[i] ?? 0, fmt) })),
    }));
    setUnbalanced(null);
  };
  const updateTotal = () => {
    if (!draft.lines || !unbalanced) return;
    const next = unbalanced.next;
    const updated: Draft = { ...draft, ...amountTexts(unbalanced.sum, fmt) };
    setDraft(updated);
    setUnbalanced(null);
    submit(next, updated);
  };
  const busy =
    save.isPending || createScheduled.isPending || updateScheduled.isPending || enterNow.isPending;

  return (
    <tbody ref={rows} className="entry-body" onKeyDown={onKeyDown}>
      <tr className="entry-row is-checked">
        <td className="cell-check">
          <Box state label="Select transaction" tabIndex={-1} onClick={() => {}} />
        </td>
        {attentionCol && <td className="cell-attention" />}
        {showFlags && <td className="cell-flag" />}
        {plan && (
          <td data-field="account">
            <AccountField
              accounts={accounts}
              currentName={chosen?.name}
              value={draft.accountId}
              disabled={lockStart}
              title={lockStart ? LOCK_TITLE : undefined}
              startOpen={initialFocus === "account" && mode === "add"}
              onChange={(id) => {
                const a = accounts.find((x) => x.id === id);
                patch({
                  accountId: id,
                  ...(a && !a.on_budget ? { category: { kind: "none" } as const } : {}),
                  // The account chosen is the transfer's other side: it is a plain row again.
                  ...(id === draft.transferAccountId
                    ? { transferAccountId: null, payee: { id: null, name: "" } }
                    : {}),
                  ...(a && !a.on_budget ? { lines: null } : {}),
                });
              }}
            />
          </td>
        )}
        <td data-field="date">
          <DateField
            text={draft.dateText}
            lastDate={draft.lastDate}
            today={today}
            onChange={(dateText, lastDate) => patch({ dateText, lastDate })}
            frequency={mode === "edit" || isPendingEdit ? undefined : draft.frequency}
            onFrequency={
              mode === "edit" || isPendingEdit ? undefined : (frequency) => patch({ frequency })
            }
          />
        </td>
        <td data-field="payee">
          <PayeeField
            payees={payeesQ.data ?? []}
            value={payeeShown}
            disabled={lockStart}
            title={lockStart ? LOCK_TITLE : undefined}
            currentAccountId={account?.id ?? draft.accountId}
            transfers={!isSplit}
            // Typing over a transfer's payee makes it a plain row again.
            onChange={(payee) => patch({ payee, transferAccountId: null })}
            onPicked={fillCategory}
            transferLabel={transferLabel}
            onTransfer={(transferAccountId, name, label) =>
              patch({
                transferAccountId,
                payee: { id: null, name: label.startsWith("Payment from") ? label : name },
              })
            }
          />
        </td>
        {showCategory && (
          <td data-field="category">
            <CategoryField
              month={monthQ.data}
              value={noCategory ? { kind: "none" } : draft.category}
              disabled={lockStart || noCategory}
              title={lockStart ? LOCK_TITLE : undefined}
              startOpen={openCategory}
              placeholder={rule === "not_needed" ? "Category not needed" : "category"}
              split={isSplit}
              splitDisabled={draft.transferAccountId ? "A transfer cannot be split" : false}
              onSplit={startSplitting}
              fixedText={isScheduledEdit ? undefined : pay?.category}
              // Picking a category drops the lines.
              onChange={(category) => patch({ category, lines: null })}
            />
          </td>
        )}
        <td data-field="memo">
          <div className="entry-input">
            <input
              type="text"
              aria-label="Memo"
              placeholder="memo"
              autoComplete="off"
              value={draft.memo}
              onChange={(e) => patch({ memo: e.target.value })}
            />
          </div>
        </td>
        <td data-field="outflow" className="num">
          <AmountField
            label="Outflow"
            value={draft.outflowText}
            onChange={(outflowText) =>
              patch(outflowText.trim() === "" ? { outflowText } : { outflowText, inflowText: "" })
            }
          />
        </td>
        <td data-field="inflow" className="num">
          <AmountField
            label="Inflow"
            value={draft.inflowText}
            onChange={(inflowText) =>
              patch(inflowText.trim() === "" ? { inflowText } : { inflowText, outflowText: "" })
            }
          />
        </td>
        {showBalance && <td className="num cell-balance" />}
        <td className="cell-cleared">
          {isScheduledEdit ? null : draft.cleared === "reconciled" ? (
            <button
              type="button"
              className="cleared-button is-reconciled"
              aria-label="This transaction is reconciled"
              title="This transaction is reconciled"
              tabIndex={-1}
              disabled
            >
              <LockIcon />
            </button>
          ) : (
            <button
              type="button"
              className={`cleared-button is-${draft.cleared}`}
              aria-label={`This transaction is ${draft.cleared}`}
              tabIndex={-1}
              onClick={() =>
                patch({ cleared: draft.cleared === "cleared" ? "uncleared" : "cleared" })
              }
            >
              {draft.cleared === "cleared" ? <ClearedFilledIcon /> : <ClearedOutlineIcon />}
            </button>
          )}
        </td>
      </tr>
      {draft.lines && (
        <SplitLines
          lines={draft.lines}
          total={parentAmount}
          payees={payeesQ.data ?? []}
          month={monthQ.data}
          lead={(attentionCol ? 2 : 1) + (showFlags ? 1 : 0) + (plan ? 1 : 0)}
          showBalance={showBalance}
          showCategory={showCategory}
          onChange={patchLine}
          onRemove={removeLine}
          onAdd={addLine}
        />
      )}
      <tr className="entry-actions-row is-checked">
        <td colSpan={colCount}>
          <div className="entry-actions">
            <span className="entry-message" role="alert">
              {message}
            </span>
            <button type="button" className="entry-button subtle" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="entry-button is-primary"
              disabled={busy}
              onClick={() => submit("close")}
            >
              {isPendingEdit
                ? "Enter Now"
                : mode === "edit" && tx && !tx.approved
                  ? "Approve"
                  : "Save"}
            </button>
            {mode === "add" && (
              <button
                type="button"
                className="entry-button is-primary"
                disabled={busy}
                onClick={() => submit("again")}
              >
                Save and add another
              </button>
            )}
          </div>
        </td>
      </tr>
      {askClosed && (
        <ClosedAccountSaveDialog
          reconciled={needsReconciledAsk(askClosed)}
          onCancel={() => setAskClosed(null)}
          onSave={() => {
            const p = askClosed;
            setAskClosed(null);
            // One dialog covers both facts: confirming it is also the reconciled confirmation (EXF-981).
            if (needsReconciledAsk(p)) send(p, true);
            else afterClosedCheck(p);
          }}
        />
      )}
      {askReconciled && (
        <ReconciledSaveDialog
          onCancel={() => setAskReconciled(null)}
          onSave={() => {
            const p = askReconciled;
            setAskReconciled(null);
            send(p, true);
          }}
        />
      )}
      {unbalanced && (
        <SplitDialog
          total={unbalanced.total}
          sum={unbalanced.sum}
          onAutoDistribute={autoDistributeLines}
          onUpdateTotal={updateTotal}
          onAdjust={() => setUnbalanced(null)}
        />
      )}
    </tbody>
  );
}
