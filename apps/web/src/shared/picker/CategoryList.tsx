import type { MonthGroupDetail } from "@budget/schema/months";
import type { CategoryChoice } from "@budget/schema/register";
import { type ReactNode, useMemo, useState } from "react";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { categoryListMenu } from "./category-menu";
import { Option, PickerInput } from "./PickerInput";

type Row = { kind: "rta" | "category"; id: string | null; name: string; amount: number };

const tone = (amount: number) => (amount > 0 ? "positive" : amount < 0 ? "negative" : "zero");

/**
 * The category dropdown of the Plan page and the register (EXF-589): a text field over a list headed by Inflow
 * (Ready to Assign, when `readyToAssign` is given) and then every group with its categories and their Available.
 * Search, highlight and keys are `PickerInput`'s; what a pick means, the field's text and its footer are the
 * caller's. Details and the choices between the two earlier copies: docs/register-entry-polish.md.
 */
export function CategoryList({
  groups,
  readyToAssign,
  value,
  text,
  onPick,
  label,
  placeholder,
  disabled,
  readOnly,
  title,
  startOpen,
  autoFocus,
  footer,
  escapeClosesList,
  className,
  caret,
}: {
  /** Already filtered by the caller. */
  groups: readonly MonthGroupDetail[];
  /** The month's Ready to Assign: offers the "Ready to Assign" row under Inflow. Left out, the list has no Inflow. */
  readyToAssign?: number;
  value: CategoryChoice;
  /** What the field shows when the user is not typing. */
  text: string;
  onPick: (v: { kind: "rta" } | { kind: "category"; id: string }) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  readOnly?: boolean;
  title?: string;
  startOpen?: boolean;
  autoFocus?: boolean;
  footer?: ReactNode;
  escapeClosesList?: boolean;
  className?: string;
  caret?: boolean;
}) {
  const fmt = usePlanFormatter();
  const [typed, setTyped] = useState<string | null>(null);
  const menu = useMemo(
    () => categoryListMenu(groups, readyToAssign, typed ?? ""),
    [groups, readyToAssign, typed],
  );
  const isCurrent = (r: Row) =>
    value.kind === "rta" ? r.kind === "rta" : value.kind === "category" && r.id === value.id;
  // With nothing typed and a value set, the list starts with a "Selected" section holding it.
  const current = typed === null ? menu.flat.find(isCurrent) : undefined;
  const items = current ? [current, ...menu.flat] : menu.flat;
  const lead = current ? 1 : 0;

  return (
    <PickerInput<Row>
      label={label}
      placeholder={placeholder}
      text={typed ?? text}
      onText={setTyped}
      items={items}
      initialActive={current ? 0 : typed === null ? -1 : 0}
      disabled={disabled}
      readOnly={readOnly}
      title={title ?? ((typed ?? text) || undefined)}
      startOpen={startOpen}
      width={400}
      listLabel="Categories"
      className={className}
      caret={caret}
      autoFocus={autoFocus}
      escapeClosesList={escapeClosesList}
      describeActive
      onBlurCommit={() => setTyped(null)}
      onPick={(r) => {
        onPick(r.kind === "rta" ? { kind: "rta" } : { kind: "category", id: r.id as string });
        setTyped(null);
      }}
      footer={footer}
      render={({ active, pick, hover, optionId }) =>
        menu.empty ? (
          <div className="entry-help">No categories found with that name.</div>
        ) : (
          (() => {
            let i = lead;
            const row = (r: Row, idx: number, key: string) => (
              <Option
                key={key}
                id={optionId(idx)}
                active={active === idx}
                name={r.name}
                checked={isCurrent(r)}
                onPick={() => pick(idx)}
                onHover={() => hover(idx)}
              >
                <span className="entry-option-name">{r.name}</span>
                <span className={`entry-available ${tone(r.amount)}`}>{fmt.money(r.amount)}</span>
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
