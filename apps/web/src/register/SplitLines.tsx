import { formatAmountEntry } from "@budget/schema/amount-entry";
import type { MonthDetail } from "@budget/schema/months";
import type { Payee } from "@budget/schema/payees";
import { splitRemaining, splitRemainingColumns } from "@budget/schema/split";
import { AmountField } from "./AmountField";
import { CategoryField } from "./CategoryField";
import { type LineDraft, lineAmount, rememberedCategory } from "./entryDraft";
import { MinusCircleFilledIcon, PlusCircleIcon } from "./icons";
import { PayeeField } from "./PayeeField";

/**
 * The lines of a split being edited, drawn as table rows under the parent, then the "Add another split"
 * row with what is left to assign. `lead` is the number of columns before the date.
 */
export function SplitLines({
  lines,
  total,
  payees,
  month,
  lead,
  showCategory,
  showBalance,
  onChange,
  onRemove,
  onAdd,
}: {
  lines: LineDraft[];
  /** The parent's amount (signed milliunits). */
  total: number;
  payees: Payee[];
  month: MonthDetail | undefined;
  lead: number;
  showCategory: boolean;
  showBalance: boolean;
  onChange: (index: number, patch: Partial<LineDraft>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  const remaining = splitRemainingColumns(
    splitRemaining(
      total,
      lines.map((l) => lineAmount(l)),
    ),
  );
  const num = (n: number) => formatAmountEntry(n);
  const lead_ = <td colSpan={lead} />;
  return (
    <>
      {lines.map((l, i) => (
        <tr key={l.key} className="entry-row split-line is-checked">
          {lead_}
          <td className="split-remove" data-line={i} data-field="remove">
            <button
              type="button"
              className="split-icon-button"
              aria-label="Remove split"
              onClick={() => onRemove(i)}
            >
              <MinusCircleFilledIcon />
            </button>
          </td>
          <td data-line={i} data-field="payee">
            <PayeeField
              payees={payees}
              value={l.payee}
              transfers={false}
              onChange={(payee) => onChange(i, { payee })}
              onPicked={(p) => {
                const c = rememberedCategory(p);
                if (l.category.kind === "none" && c) onChange(i, { category: c });
              }}
            />
          </td>
          {showCategory && (
            <td data-line={i} data-field="category">
              <CategoryField
                month={month}
                value={l.category}
                footer="none"
                onChange={(category) => onChange(i, { category })}
              />
            </td>
          )}
          <td data-line={i} data-field="memo">
            <div className="entry-input">
              <input
                type="text"
                aria-label="Memo"
                placeholder="memo"
                autoComplete="off"
                value={l.memo}
                onChange={(e) => onChange(i, { memo: e.target.value })}
              />
            </div>
          </td>
          <td data-line={i} data-field="outflow" className="num">
            <AmountField
              label="Outflow"
              value={l.outflowText}
              onChange={(outflowText) =>
                onChange(
                  i,
                  outflowText.trim() === "" ? { outflowText } : { outflowText, inflowText: "" },
                )
              }
            />
          </td>
          <td data-line={i} data-field="inflow" className="num">
            <AmountField
              label="Inflow"
              value={l.inflowText}
              onChange={(inflowText) =>
                onChange(
                  i,
                  inflowText.trim() === "" ? { inflowText } : { inflowText, outflowText: "" },
                )
              }
            />
          </td>
          {showBalance && <td className="num cell-balance" />}
          <td className="cell-cleared" />
        </tr>
      ))}
      <tr className="entry-row split-remaining is-checked">
        {lead_}
        <td className="split-add-cell">
          <button type="button" className="split-add" onClick={onAdd}>
            <PlusCircleIcon width={12} height={12} />
            <span>Add another split</span>
          </button>
        </td>
        <td colSpan={showCategory ? 2 : 1} />
        <td className="split-remaining-label">Amount remaining to assign:</td>
        <td className="num split-remaining-number" data-field="remaining-outflow">
          {num(remaining.outflow)}
        </td>
        <td className="num split-remaining-number" data-field="remaining-inflow">
          {num(remaining.inflow)}
        </td>
        {showBalance && <td className="num cell-balance" />}
        <td className="cell-cleared" />
      </tr>
    </>
  );
}
