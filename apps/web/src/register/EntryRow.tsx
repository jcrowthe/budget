import type { Account } from "@budget/schema/accounts";
import type { Payee } from "@budget/schema/payees";
import { autoDistribute, splitSum } from "@budget/schema/split";
import type { TransactionDetail } from "@budget/schema/transactions";
import { transferCategoryRule } from "@budget/schema/transfers";
import { useEffect, useRef, useState } from "react";
import { useAccounts } from "../api/accounts";
import { useMonth } from "../api/months";
import { usePayees } from "../api/payees";
import { useSaveTransaction } from "../api/transactions";
import { AccountField } from "./AccountField";
import { AmountField } from "./AmountField";
import { Box } from "./Box";
import { CategoryField } from "./CategoryField";
import { DateField } from "./DateField";
import {
  amountTexts,
  type Draft,
  draftAmount,
  draftError,
  draftFromTx,
  draftToCreate,
  draftToPatch,
  emptyDraft,
  emptyLine,
  type Field,
  type LineDraft,
  lineAmount,
  rememberedCategory,
} from "./entryDraft";
import { localToday } from "./format";
import { ClearedFilledIcon, ClearedOutlineIcon } from "./icons";
import { PayeeField } from "./PayeeField";
import { SplitDialog } from "./SplitDialog";
import { SplitLines } from "./SplitLines";

const LOCK_TITLE = "A credit account's Starting Balance keeps its payee and category.";

/** The inline add and edit row (EXF-517): the fields, then Cancel, Save and Save and add another. */
export function EntryRow({
  budgetId,
  mode,
  tx,
  account,
  accounts,
  plan,
  showCategory,
  lockStart,
  date,
  initialFocus,
  openCategory,
  startSplit,
  onClose,
  onSaved,
}: {
  budgetId: string;
  mode: "add" | "edit";
  tx?: TransactionDetail;
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
  openCategory?: boolean;
  /** Open with two empty lines (the S key). */
  startSplit?: boolean;
  onClose: () => void;
  onSaved: (next: "close" | "again", date: string) => void;
}) {
  const today = localToday();
  const [draft, setDraft] = useState<Draft>(() => {
    const d = tx ? draftFromTx(tx) : emptyDraft(date ?? today, account?.id ?? null);
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
  const [lineFocus, setLineFocus] = useState<{ line: number; n: number } | null>(null);
  const accountsQ = useAccounts(budgetId);
  const rows = useRef<HTMLTableSectionElement>(null);
  // Set synchronously, so two key events in one tick cannot both start a save.
  const saving = useRef(false);
  const payeesQ = usePayees(budgetId);
  const save = useSaveTransaction(budgetId);
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
    const err = draftError(d, today, plan);
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
      const total = draftAmount(d);
      const sum = splitSum(d.lines.map(lineAmount));
      if (sum !== total) {
        setMessage(null);
        setUnbalanced({ total, sum, next });
        return;
      }
    }
    setMessage(null);
    const accountId = account?.id ?? (d.accountId as string);
    const body =
      mode === "edit" && tx ? draftToPatch(tx, d, today) : draftToCreate(d, accountId, today);
    if (mode === "edit" && Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const iso = (body as { date?: string }).date ?? d.lastDate;
    saving.current = true;
    save.mutate(
      { id: mode === "edit" ? tx?.id : undefined, body },
      {
        onSuccess: () => onSaved(next, iso),
        onError: (e) => setMessage(`Couldn't save the transaction. ${e.message}`),
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

  const colCount = (plan ? 1 : 0) + (showCategory ? 1 : 0) + 7;
  const parentAmount = draftAmount(draft);

  const autoDistributeLines = () => {
    if (!draft.lines || !unbalanced) return;
    const spread = autoDistribute(unbalanced.total, draft.lines.map(lineAmount));
    setDraft((d) => ({
      ...d,
      lines: (d.lines ?? []).map((l, i) => ({ ...l, ...amountTexts(spread[i] ?? 0) })),
    }));
    setUnbalanced(null);
  };
  const updateTotal = () => {
    if (!draft.lines || !unbalanced) return;
    const next = unbalanced.next;
    const updated: Draft = { ...draft, ...amountTexts(unbalanced.sum) };
    setDraft(updated);
    setUnbalanced(null);
    submit(next, updated);
  };
  const busy = save.isPending;

  return (
    <tbody ref={rows} className="entry-body" onKeyDown={onKeyDown}>
      <tr className="entry-row is-checked">
        <td className="cell-check">
          <Box state label="Select transaction" tabIndex={-1} onClick={() => {}} />
        </td>
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
          />
        </td>
        <td data-field="payee">
          <PayeeField
            payees={payeesQ.data ?? []}
            value={draft.payee}
            disabled={lockStart}
            title={lockStart ? LOCK_TITLE : undefined}
            currentAccountId={account?.id ?? draft.accountId}
            transfers={!isSplit}
            // Typing over a transfer's payee makes it a plain row again.
            onChange={(payee) => patch({ payee, transferAccountId: null })}
            onPicked={fillCategory}
            onTransfer={(transferAccountId, name) =>
              patch({ transferAccountId, payee: { id: null, name } })
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
        <td className="cell-cleared">
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
        </td>
      </tr>
      {draft.lines && (
        <SplitLines
          lines={draft.lines}
          total={parentAmount}
          payees={payeesQ.data ?? []}
          month={monthQ.data}
          lead={1 + (plan ? 1 : 0)}
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
              Save
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
