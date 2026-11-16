import { formatMoney } from "@budget/core/money";
import type { MonthDetail } from "@budget/schema/months";
import { categoryLabel, categoryMenu } from "@budget/schema/register";
import { useMemo, useState } from "react";
import type { CategoryValue } from "./entryDraft";
import { Option, PickerInput } from "./PickerInput";

type Row = { kind: "rta" | "category"; id: string | null; name: string; amount: number };

const tone = (amount: number) => (amount > 0 ? "positive" : amount < 0 ? "negative" : "zero");

/** The register's own category dropdown (not the Plan's picker): Inflow, then every group (EXF-517). */
export function CategoryField({
  month,
  value,
  disabled,
  title,
  startOpen,
  onChange,
}: {
  month: MonthDetail | undefined;
  value: CategoryValue;
  disabled?: boolean;
  title?: string;
  startOpen?: boolean;
  onChange: (v: CategoryValue) => void;
}) {
  const groups = month?.groups ?? [];
  const shown = categoryLabel(value, groups);
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
      placeholder="category"
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
        <>
          <button
            type="button"
            className="entry-footer-button"
            disabled
            aria-disabled="true"
            data-ticket="EXF-526"
          >
            Payment/Transfer
          </button>
          <button
            type="button"
            className="entry-footer-button"
            disabled
            aria-disabled="true"
            data-ticket="EXF-524"
          >
            Split (Multiple Categories)
          </button>
        </>
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
