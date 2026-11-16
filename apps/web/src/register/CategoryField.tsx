import { formatMoney } from "@budget/core/money";
import type { MonthDetail } from "@budget/schema/months";
import { categoryLabel, categoryMenu } from "@budget/schema/register";
import { useMemo, useState } from "react";
import type { CategoryValue } from "./entryDraft";
import { Option, PickerInput } from "./PickerInput";

type Row = { kind: "rta" | "category"; id: string | null; name: string; amount: number };

const SPLIT_TEXT = "Split (Multiple Categories)...";

const tone = (amount: number) => (amount > 0 ? "positive" : amount < 0 ? "negative" : "zero");

/** The register's own category dropdown (not the Plan's picker): Inflow, then every group (EXF-517). */
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
}) {
  const groups = month?.groups ?? [];
  const shown = split ? SPLIT_TEXT : categoryLabel(value, groups);
  const [typed, setTyped] = useState<string | null>(null);
  const menu = useMemo(
    () => categoryMenu(groups, month?.ready_to_assign ?? 0, typed ?? ""),
    [groups, month?.ready_to_assign, typed],
  );
  const isCurrent = (r: Row) =>
    value.kind === "rta" ? r.kind === "rta" : value.kind === "category" && r.id === value.id;
  // With nothing typed and a value set, the list starts with a "Selected" section holding it.
  const current = typed === null ? menu.flat.find(isCurrent) : undefined;
  const items = current ? [current, ...menu.flat] : menu.flat;
  const lead = current ? 1 : 0;

  return (
    <PickerInput<Row>
      label="Category"
      placeholder={placeholder}
      text={typed ?? shown}
      onText={setTyped}
      items={items}
      initialActive={current ? 0 : typed === null ? -1 : 0}
      disabled={disabled}
      title={title}
      startOpen={startOpen}
      width={400}
      listLabel="Categories"
      onBlurCommit={() => setTyped(null)}
      onPick={(r) => {
        onChange(r.kind === "rta" ? { kind: "rta" } : { kind: "category", id: r.id as string });
        setTyped(null);
      }}
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
      render={({ active, pick, hover }) =>
        menu.empty ? (
          <div className="entry-help">No categories found with that name.</div>
        ) : (
          (() => {
            let i = lead;
            const row = (r: Row, idx: number, key: string) => (
              <Option
                key={key}
                active={active === idx}
                name={r.name}
                checked={isCurrent(r)}
                onPick={() => pick(idx)}
                onHover={() => hover(idx)}
              >
                <span className="entry-option-name">{r.name}</span>
                <span className={`entry-available ${tone(r.amount)}`}>{formatMoney(r.amount)}</span>
              </Option>
            );
            return (
              <>
                {current ? (
                  <div>
                    <div role="presentation" className="entry-heading">
                      Selected
                    </div>
                    {row(current, 0, "selected")}
                  </div>
                ) : null}
                {menu.groups.map((g) => (
                  <div key={g.name}>
                    <div role="presentation" className="entry-heading">
                      {g.name}
                    </div>
                    {g.rows.map((r) => row(r, i++, r.id ?? "rta"))}
                  </div>
                ))}
              </>
            );
          })()
        )
      }
    />
  );
}
