import { evaluateAssigned, formatAssignedInput } from "@budget/schema/assigned-edit";
import {
  dayOfMonthOptions,
  type TargetDraft,
  unitOptions,
  WEEKDAYS,
  yearOptions,
} from "@budget/schema/target-form";
import { behaviorOptions, type FormTab } from "@budget/schema/target-wording";
import { useEffect, useId, useRef, useState } from "react";
import { Calculator } from "../AssignedCell";
import { money } from "../format";
import { TrashIcon } from "../icons";
import { BehaviorDropdown } from "./BehaviorDropdown";
import { Switch } from "./Switch";
import { TargetDateField } from "./TargetDateField";

const TABS: { id: FormTab; label: string }[] = [
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
  { id: "custom", label: "Custom" },
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The amount: `$0.00` until focused, then the raw text; arithmetic is evaluated when the field loses focus. */
function TargetAmountField({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: number;
  onChange: (m: number) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const selectNext = useRef(false);
  // The raw text replaces the formatted amount on focus: select it, so typing starts over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the text appears
  useEffect(() => {
    if (selectNext.current && text !== null) {
      selectNext.current = false;
      input.current?.select();
    }
  }, [text]);
  const commit = () => {
    if (text !== null) onChange(text.trim() === "" ? 0 : evaluateAssigned(text, value));
  };
  return (
    <div className="target-field target-amount">
      <input
        ref={input}
        type="text"
        className="target-input"
        aria-label="Target Amount"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        // biome-ignore lint/a11y/noAutofocus: opening the form puts the cursor in the amount, as the source does
        autoFocus
        value={text ?? money(value)}
        onFocus={() => {
          selectNext.current = true;
          setText(value === 0 ? "" : formatAssignedInput(value));
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          commit();
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            setText(null);
            input.current?.select();
          }
        }}
      />
      <Calculator />
    </div>
  );
}

/** The form of the Target card: four tabs, their fields, and Delete, Cancel and Save Target. */
export function TargetForm({
  draft,
  onDraft,
  today,
  errors,
  busy,
  failure,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: TargetDraft;
  onDraft: (f: (d: TargetDraft) => TargetDraft) => void;
  today: string;
  errors: { amount?: string; date?: string };
  busy: boolean;
  failure: string | null;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const set = (patch: Partial<TargetDraft>) => onDraft((d) => ({ ...d, ...patch }));
  const tab = draft.tab;
  const custom = tab === "custom";
  const behavior = custom ? draft.custom : draft.periodic;
  const options = behaviorOptions(tab, draft.amount);
  const nextLabel = tab === "yearly" ? "Next year I want to" : "Next month I want to";
  const field = (label: string, control: React.ReactNode, key = label) => (
    <dl className="target-block" key={key}>
      <dt id={`${id}-${key}`}>{label}</dt>
      <dd>{control}</dd>
    </dl>
  );
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length];
    if (next) set({ tab: next.id });
    const tabs = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=tab]");
    tabs?.[(to + TABS.length) % TABS.length]?.focus();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the form cancels it, as in the source
    <div
      className="target-form"
      aria-busy={busy || undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="target-tabs" role="tablist" aria-label="Target type">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className="target-tab"
            disabled={busy}
            onClick={() => set({ tab: t.id })}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {field(
        custom ? "Amount" : "I need",
        <TargetAmountField
          value={draft.amount}
          onChange={(amount) => set({ amount })}
          disabled={busy}
          invalid={!!errors.amount}
        />,
        "amount",
      )}
      {errors.amount && (
        <p className="target-error" role="alert">
          {errors.amount}
        </p>
      )}

      {custom && field("I want to", dropdown(), "behavior")}

      {tab === "weekly" &&
        field(
          "Every",
          <span className="select-wrap">
            <select
              className="target-select"
              aria-label="Select Day of Week"
              disabled={busy}
              value={draft.dayOfWeek}
              onChange={(e) => set({ dayOfWeek: Number(e.target.value) })}
            >
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={i}>
                  {w}
                </option>
              ))}
            </select>
          </span>,
          "weekday",
        )}
      {tab === "monthly" &&
        field(
          "By",
          <span className="select-wrap">
            <select
              className="target-select"
              aria-label="Select Day of Month"
              disabled={busy}
              value={draft.dayOfMonth ?? ""}
              onChange={(e) =>
                set({ dayOfMonth: e.target.value === "" ? null : Number(e.target.value) })
              }
            >
              {dayOfMonthOptions().map((o) => (
                <option key={o.label} value={o.value ?? ""}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>,
          "day",
        )}
      {tab === "yearly" &&
        field(
          "By",
          <TargetDateField
            label="By"
            value={draft.yearlyDate}
            onChange={(yearlyDate) => set({ yearlyDate })}
            today={today}
            disabled={busy}
            invalid={!!errors.date}
          />,
          "date",
        )}

      {!custom && field(nextLabel, dropdown(), "behavior")}

      {custom && draft.custom !== "balance" && (
        <>
          {field(
            "Due on",
            <TargetDateField
              label="Due on"
              value={draft.customDate}
              onChange={(customDate) => set({ customDate })}
              today={today}
              disabled={busy}
              invalid={!!errors.date}
            />,
            "due",
          )}
          <div className="target-block">
            <Switch
              label="Repeat"
              checked={draft.repeat}
              disabled={busy}
              onChange={(repeat) => set({ repeat })}
            />
          </div>
          {draft.repeat &&
            field(
              "Every",
              <div className="target-pair">
                <span className="select-wrap">
                  <select
                    className="target-select"
                    aria-label="Select Interval"
                    disabled={busy}
                    value={draft.every}
                    onChange={(e) => set({ every: Number(e.target.value) })}
                  >
                    {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="select-wrap">
                  <select
                    className="target-select"
                    aria-label="Select Unit of Time"
                    disabled={busy}
                    value={draft.unit}
                    onChange={(e) => set({ unit: e.target.value as "month" | "year" })}
                  >
                    {unitOptions(draft.every).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>,
              "every",
            )}
        </>
      )}
      {custom && draft.custom === "balance" && (
        <>
          <div className="target-block">
            <Switch
              label="Due by date"
              checked={draft.dueBy}
              disabled={busy}
              onChange={(dueBy) => set({ dueBy })}
            />
          </div>
          {draft.dueBy &&
            field(
              "Due on",
              <div className="target-pair">
                <span className="select-wrap">
                  <select
                    className="target-select month-select"
                    aria-label="Select Month"
                    disabled={busy}
                    value={draft.dueMonth}
                    onChange={(e) => set({ dueMonth: Number(e.target.value) })}
                  >
                    {MONTH_NAMES.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="select-wrap year-wrap">
                  <select
                    className="target-select year-select"
                    aria-label="Select Year"
                    disabled={busy}
                    value={draft.dueYear}
                    onChange={(e) => set({ dueYear: Number(e.target.value) })}
                  >
                    {yearOptions(today).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </span>
              </div>,
              "dueon",
            )}
        </>
      )}
      {errors.date && (
        <p className="target-error" role="alert">
          {errors.date}
        </p>
      )}
      {failure && (
        <p className="target-error" role="alert">
          {failure}
        </p>
      )}

      <div className="target-actions">
        <button type="button" className="target-delete" disabled={busy} onClick={onDelete}>
          <TrashIcon width={16} height={16} />
          Delete
        </button>
        <span className="target-actions-end">
          <button type="button" className="target-cancel" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="target-save" disabled={busy} onClick={onSave}>
            Save Target
          </button>
        </span>
      </div>
    </div>
  );

  function dropdown() {
    return (
      <BehaviorDropdown
        labelId={`${id}-behavior`}
        options={options}
        value={behavior}
        disabled={busy}
        onChange={(v) =>
          set(
            custom
              ? { custom: v as TargetDraft["custom"] }
              : { periodic: v as TargetDraft["periodic"] },
          )
        }
      />
    );
  }
}
