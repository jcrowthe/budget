import { addMonths, formatEntryDate, parseEntryDate } from "./date-entry";
import type { FormTab } from "./target-wording";
import { ordinal } from "./target-wording";
import type { TargetBody, TargetDefinition } from "./targets";

// The Target card's form as plain data: its defaults, the prefill from a saved target and the body to send.

export interface TargetDraft {
  tab: FormTab;
  /** Milliunits; 0 until typed. */
  amount: number;
  /** The Weekly, Monthly and Yearly choice, remembered apart from the Custom one. */
  periodic: "set_aside" | "refill";
  custom: "set_aside" | "fill_up" | "balance";
  dayOfWeek: number;
  /** null = the last day of the month. */
  dayOfMonth: number | null;
  /** MM/DD/YYYY as typed. */
  yearlyDate: string;
  customDate: string;
  repeat: boolean;
  every: number;
  unit: "month" | "year";
  dueBy: boolean;
  /** 0..11 */
  dueMonth: number;
  dueYear: number;
}

export const WEEKDAYS: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const firstOfNextMonth = (today: string) => addMonths(`${today.slice(0, 7)}-01`, 1);

export function newDraft(today: string): TargetDraft {
  const next = firstOfNextMonth(today);
  const date = formatEntryDate(next);
  return {
    tab: "monthly",
    amount: 0,
    periodic: "set_aside",
    custom: "set_aside",
    dayOfWeek: 6,
    dayOfMonth: null,
    yearlyDate: date,
    customDate: date,
    repeat: false,
    every: 1,
    unit: "month",
    dueBy: false,
    dueMonth: Number(next.slice(5, 7)) - 1,
    dueYear: Number(next.slice(0, 4)),
  };
}

export function draftFromTarget(def: TargetDefinition, today: string): TargetDraft {
  const d: TargetDraft = { ...newDraft(today), tab: def.cadence, amount: def.amount };
  if (def.cadence === "custom") {
    d.custom = def.behavior === "refill" ? "set_aside" : def.behavior;
    if (def.behavior === "balance") {
      if (def.due_month) {
        d.dueBy = true;
        d.dueMonth = Number(def.due_month.slice(5, 7)) - 1;
        d.dueYear = Number(def.due_month.slice(0, 4));
      }
    } else {
      if (def.due_date) d.customDate = formatEntryDate(def.due_date);
      if (def.repeat) {
        d.repeat = true;
        d.every = def.repeat.every;
        d.unit = def.repeat.unit;
      }
    }
    return d;
  }
  d.periodic = def.behavior === "refill" ? "refill" : "set_aside";
  if (def.cadence === "weekly") d.dayOfWeek = def.day_of_week ?? 6;
  if (def.cadence === "monthly") d.dayOfMonth = def.day_of_month;
  if (def.cadence === "yearly" && def.due_date) d.yearlyDate = formatEntryDate(def.due_date);
  return d;
}

export const AMOUNT_ERROR = "Enter an amount greater than $0.00.";
export const DATE_ERROR = "Enter a valid date.";

export function draftToBody(
  d: TargetDraft,
  today: string,
): { body: TargetBody } | { errors: { amount?: string; date?: string } } {
  const errors: { amount?: string; date?: string } = {};
  if (!(d.amount > 0)) errors.amount = AMOUNT_ERROR;
  const date = (text: string): string => {
    const iso = parseEntryDate(text, today);
    if (iso === null) errors.date = DATE_ERROR;
    return iso ?? "";
  };
  let body: TargetBody;
  switch (d.tab) {
    case "weekly":
      body = {
        cadence: "weekly",
        behavior: d.periodic,
        amount: d.amount,
        day_of_week: d.dayOfWeek,
      };
      break;
    case "monthly":
      body = {
        cadence: "monthly",
        behavior: d.periodic,
        amount: d.amount,
        day_of_month: d.dayOfMonth,
      };
      break;
    case "yearly":
      body = {
        cadence: "yearly",
        behavior: d.periodic,
        amount: d.amount,
        due_date: date(d.yearlyDate),
      };
      break;
    case "custom":
      if (d.custom === "balance") {
        body = {
          cadence: "custom",
          behavior: "balance",
          amount: d.amount,
          due_month: d.dueBy
            ? `${String(d.dueYear).padStart(4, "0")}-${String(d.dueMonth + 1).padStart(2, "0")}-01`
            : null,
        };
      } else {
        body = {
          cadence: "custom",
          behavior: d.custom,
          amount: d.amount,
          due_date: date(d.customDate),
          repeat: d.repeat ? { every: d.every, unit: d.unit } : null,
        };
      }
      break;
  }
  return errors.amount || errors.date ? { errors } : { body };
}

/** "Last Day of Month", then 31st down to 1st. */
export function dayOfMonthOptions(): { value: number | null; label: string }[] {
  return [
    { value: null, label: "Last Day of Month" },
    ...Array.from({ length: 31 }, (_, i) => 31 - i).map((n) => ({ value: n, label: ordinal(n) })),
  ];
}

/** Fifty years, from the year of `today`. */
export function yearOptions(today: string): number[] {
  const y = Number(today.slice(0, 4));
  return Array.from({ length: 50 }, (_, i) => y + i);
}

export function unitOptions(every: number): { value: "month" | "year"; label: string }[] {
  const s = every > 1 ? "s" : "";
  return [
    { value: "month", label: `Month${s}` },
    { value: "year", label: `Year${s}` },
  ];
}
