import type { Account } from "@budget/schema/accounts";
import type { Payee } from "@budget/schema/payees";
import type { TransactionDetail } from "@budget/schema/transactions";
import { useEffect, useRef, useState } from "react";
import { useMonth } from "../api/months";
import { usePayees } from "../api/payees";
import { useSaveTransaction } from "../api/transactions";
import { AccountField } from "./AccountField";
import { AmountField } from "./AmountField";
import { Box } from "./Box";
import { CategoryField } from "./CategoryField";
import { DateField } from "./DateField";
import {
  type Draft,
  draftError,
  draftFromTx,
  draftToCreate,
  draftToPatch,
  emptyDraft,
  type Field,
} from "./entryDraft";
import { localToday } from "./format";
import { ClearedFilledIcon, ClearedOutlineIcon } from "./icons";
import { PayeeField } from "./PayeeField";

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
  onClose: () => void;
  onSaved: (next: "close" | "again", date: string) => void;
}) {
  const today = localToday();
  const [draft, setDraft] = useState<Draft>(() =>
    tx ? draftFromTx(tx) : emptyDraft(date ?? today, account?.id ?? null),
  );
  const [message, setMessage] = useState<string | null>(null);
  const rows = useRef<HTMLTableSectionElement>(null);
  // Set synchronously, so two key events in one tick cannot both start a save.
  const saving = useRef(false);
  const payeesQ = usePayees(budgetId);
  const save = useSaveTransaction(budgetId);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const monthOf = `${(draft.lastDate || today).slice(0, 7)}-01`;
  const monthQ = useMonth(budgetId, monthOf);
  const chosen = account ?? accounts.find((a) => a.id === draft.accountId);
  const noCategory = !!chosen && !chosen.on_budget;

  const focusField = (f: Field) => {
    const el = rows.current?.querySelector<HTMLElement>(`[data-field="${f}"] input`);
    el?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, when the row opens
  useEffect(() => {
    focusField(initialFocus);
  }, []);

  const submit = (next: "close" | "again") => {
    if (saving.current) return;
    const err = draftError(draft, today, plan);
    if (err) {
      setMessage(err.message);
      focusField(err.field);
      return;
    }
    setMessage(null);
    const accountId = account?.id ?? (draft.accountId as string);
    const body =
      mode === "edit" && tx
        ? draftToPatch(tx, draft, today)
        : draftToCreate(draft, accountId, today);
    if (mode === "edit" && Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const iso = (body as { date?: string }).date ?? draft.lastDate;
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
    if (draft.category.kind === "none" && p.last_category_id && !noCategory) {
      patch({ category: { kind: "category", id: p.last_category_id } });
    }
  };

  const colCount = (plan ? 1 : 0) + (showCategory ? 1 : 0) + 7;
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
              value={draft.accountId}
              disabled={lockStart}
              title={lockStart ? LOCK_TITLE : undefined}
              startOpen={initialFocus === "account" && mode === "add"}
              onChange={(id) => {
                const a = accounts.find((x) => x.id === id);
                patch({
                  accountId: id,
                  ...(a && !a.on_budget ? { category: { kind: "none" } as const } : {}),
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
            onChange={(payee) => patch({ payee })}
            onPicked={fillCategory}
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
              onChange={(category) => patch({ category })}
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
    </tbody>
  );
}
