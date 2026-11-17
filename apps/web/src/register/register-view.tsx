import { effectiveRange, presetRange, yearOptions } from "@budget/schema/register-view";
import {
  VIEW_DEFAULTS,
  VIEW_PRESETS,
  type ViewPreset,
  type ViewSettings,
} from "@budget/schema/view-settings";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAccountTransactions, usePlanTransactions } from "../api/transactions";
import { useSaveViewSettings, useViewSettings, type ViewSettingsPatch } from "../api/view-settings";
import { useCurrentPlan } from "../shell/useCurrentPlan";
import { Box } from "./Box";
import { localToday } from "./format";
import { Popover } from "./Popover";
import "./register-view.css";

/** What the register reads from the person's view settings (EXF-529). */
export type RegisterView = {
  /** False until the settings are read: the table waits. */
  ready: boolean;
  settings: ViewSettings;
  today: string;
  /** The first month of the plan's data: the From of All Dates. */
  firstMonth: string;
  showFlags: boolean;
  /** A BALANCE column: an account's page only. */
  showBalance: boolean;
  save: (patch: ViewSettingsPatch) => void;
};

export const RegisterViewContext = createContext<RegisterView>({
  ready: true,
  settings: VIEW_DEFAULTS,
  today: "",
  firstMonth: "",
  showFlags: true,
  showBalance: false,
  save: () => {},
});
export const useRegisterView = () => useContext(RegisterViewContext);

/** The settings of an account's page (`accountId`) or of All Accounts, with the data the popover needs. */
export function useRegisterViewState(budgetId: string, accountId?: string): RegisterView {
  const scope = accountId ?? "all";
  const q = useViewSettings(budgetId, scope);
  const mutate = useSaveViewSettings(budgetId, scope).mutate;
  const { plan } = useCurrentPlan();
  // The same queries as the table's: one request for each, whoever asks first.
  const accountRows = useAccountTransactions(budgetId, accountId ?? "", !!accountId);
  const planRows = usePlanTransactions(budgetId, !accountId);
  const rows = (accountId ? accountRows : planRows).data?.transactions;
  const oldest = useMemo(() => {
    let min: string | undefined;
    for (const r of rows ?? []) if (!min || r.date < min) min = r.date;
    return min;
  }, [rows]);
  const today = localToday();
  const firstMonth = useMemo(() => {
    // Today's month is the floor while the plan and the list are still loading.
    const candidates = [`${today.slice(0, 7)}-01`];
    if (plan?.created_at) candidates.push(`${plan.created_at.slice(0, 7)}-01`);
    if (oldest) candidates.push(`${oldest.slice(0, 7)}-01`);
    return candidates.sort()[0] as string;
  }, [today, plan?.created_at, oldest]);
  const settings = q.data ?? VIEW_DEFAULTS;
  const save = useCallback((patch: ViewSettingsPatch) => mutate(patch), [mutate]);
  return {
    // A failed read uses the defaults.
    ready: !q.isPending,
    settings,
    today,
    firstMonth,
    showFlags: settings.show_flags,
    showBalance: !!accountId && settings.show_running_balance,
    save,
  };
}

const PRESET_LABEL: Record<Exclude<ViewPreset, "custom">, string> = {
  this_month: "This Month",
  last_month: "Last Month",
  latest_3_months: "Latest 3 Months",
  this_year: "This Year",
  last_year: "Last Year",
  all_dates: "All Dates",
};
const MONTHS = [
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

type Draft = Pick<
  ViewSettings,
  | "preset"
  | "range_from"
  | "range_to"
  | "show_reconciled"
  | "show_running_balance"
  | "show_flags"
  | "show_images"
>;

function MonthYear({
  label,
  month,
  years,
  onChange,
}: {
  label: string;
  month: string;
  years: number[];
  onChange: (month: string) => void;
}) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const set = (year: number, mo: number) =>
    onChange(`${String(year).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`);
  const all = years.includes(y) ? years : [...years, y].sort((a, b) => a - b);
  return (
    <>
      <span className="view-select">
        <select
          aria-label={`${label} month`}
          value={m}
          onChange={(e) => set(y, Number(e.target.value))}
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </span>
      <span className="view-select is-year">
        <select
          aria-label={`${label} year`}
          value={y}
          onChange={(e) => set(Number(e.target.value), m)}
        >
          {all.map((yr) => (
            <option key={yr} value={yr}>
              {yr}
            </option>
          ))}
        </select>
      </span>
    </>
  );
}

/** "View Options": presets save at once; the selects and checkboxes wait for Apply. */
export function ViewOptionsPopover({
  anchor,
  scope,
  settings,
  firstMonth,
  today,
  onSave,
  onClose,
}: {
  anchor: HTMLElement;
  scope: "account" | "all";
  settings: ViewSettings;
  firstMonth: string;
  today: string;
  onSave: (patch: ViewSettingsPatch) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...settings });
  const range =
    effectiveRange(draft, today, firstMonth) ?? presetRange("all_dates", today, firstMonth);
  const years = yearOptions(firstMonth, today);
  const setRange = (which: "from" | "to", month: string) =>
    setDraft((d) => ({
      ...d,
      preset: "custom",
      range_from: which === "from" ? month : range.from,
      range_to: which === "to" ? month : range.to,
    }));
  const check = (
    key: "show_reconciled" | "show_running_balance" | "show_flags" | "show_images",
    label: string,
  ) => (
    <li key={key}>
      <Box
        state={draft[key]}
        label={label}
        onClick={() => setDraft((d) => ({ ...d, [key]: !d[key] }))}
      />
      <button
        type="button"
        className="view-check-label"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => setDraft((d) => ({ ...d, [key]: !d[key] }))}
      >
        {label}
      </button>
    </li>
  );
  const apply = () => {
    const patch: ViewSettingsPatch = {
      preset: draft.preset,
      show_reconciled: draft.show_reconciled,
      show_flags: draft.show_flags,
      show_images: draft.show_images,
    };
    if (draft.preset === "custom") {
      patch.range_from = draft.range_from;
      patch.range_to = draft.range_to;
    }
    if (scope === "account") patch.show_running_balance = draft.show_running_balance;
    onSave(patch);
    onClose();
  };
  return (
    <Popover
      anchor={anchor}
      placement="below"
      width={632}
      label="View Options"
      role="dialog"
      className="view-options"
      bodyClass="view-options-body"
      onClose={onClose}
    >
      <h2 className="view-title">View Options</h2>
      <ul className="view-presets">
        {VIEW_PRESETS.filter((p): p is Exclude<ViewPreset, "custom"> => p !== "custom").map((p) => (
          <li key={p}>
            <button
              type="button"
              className={`view-pill${draft.preset === p ? " is-active" : ""}`}
              aria-pressed={draft.preset === p}
              onClick={() => {
                onSave({ preset: p });
                onClose();
              }}
            >
              {PRESET_LABEL[p]}
            </button>
          </li>
        ))}
      </ul>
      <hr className="view-hr" />
      <div className="view-range">
        <span className="view-range-label">From:</span>
        <MonthYear
          label="From"
          month={range.from}
          years={years}
          onChange={(m) => setRange("from", m)}
        />
        <span className="view-range-label is-to">To:</span>
        <MonthYear label="To" month={range.to} years={years} onChange={(m) => setRange("to", m)} />
      </div>
      <hr className="view-hr" />
      <ul className="view-checks">
        {check("show_reconciled", "Show Reconciled Transactions")}
        {scope === "account" && check("show_running_balance", "Show Running Balance")}
        {check("show_flags", "Show Flags")}
        {check("show_images", "Show Images")}
      </ul>
      <div className="view-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={apply}>
          Apply
        </button>
      </div>
    </Popover>
  );
}
