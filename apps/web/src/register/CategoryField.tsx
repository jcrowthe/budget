import type { MonthDetail } from "@budget/schema/months";
import { categoryLabel } from "@budget/schema/register";
import { CategoryList } from "../shared/picker/CategoryList";
import type { CategoryValue } from "./entryDraft";

const SPLIT_TEXT = "Split (Multiple Categories)...";

/** The register's category field: the shared category list (EXF-517, EXF-589) with a Split footer and `<Group>: <Category>` text. */
export function CategoryField({
  month,
  value,
  disabled,
  title,
  startOpen,
  placeholder = "category",
  split,
  splitDisabled,
  footer = "split",
  onSplit,
  onChange,
  fixedText,
}: {
  month: MonthDetail | undefined;
  value: CategoryValue;
  disabled?: boolean;
  title?: string;
  startOpen?: boolean;
  /** "Category not needed" when a transfer between on-plan accounts takes none. */
  placeholder?: string;
  /** The parent of a split: the field reads "Split (Multiple Categories)...". */
  split?: boolean;
  /** Why Split is unavailable (a transfer cannot be split), or false. */
  splitDisabled?: string | false;
  /** A split line has no footer. */
  footer?: "split" | "none";
  onSplit?: () => void;
  onChange: (v: CategoryValue) => void;
  /** A card payment's category ("Credit Card Payments: <card>"): shown as text, disabled, no list. */
  fixedText?: string;
}) {
  const groups = month?.groups ?? [];
  const fixed = fixedText !== undefined;

  return (
    <CategoryList
      label="Category"
      placeholder={placeholder}
      groups={groups}
      readyToAssign={month?.ready_to_assign ?? 0}
      value={value}
      text={fixedText ?? (split ? SPLIT_TEXT : categoryLabel(value, groups))}
      onPick={onChange}
      disabled={disabled && !fixed}
      readOnly={fixed}
      title={fixedText ?? title}
      startOpen={startOpen && !fixed}
      footer={
        footer === "split" ? (
          <button
            type="button"
            className="entry-footer-button entry-split-button"
            disabled={!!splitDisabled}
            aria-disabled={!!splitDisabled}
            title={splitDisabled || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSplit?.()}
          >
            Split (Multiple Categories)
          </button>
        ) : undefined
      }
    />
  );
}
