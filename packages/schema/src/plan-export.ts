/**
 * Export Plan, the pure half: the format (amounts, dates, delimiter, extension), the text-field encoder with its
 * formula guard, the file names and the rows of the Plan and Register files. No I/O; the Worker service reads the
 * plan and calls these. Design: docs/plan-export-design.md.
 */
import { z } from "@hono/zod-openapi";
import { MANUAL_ADJUSTMENT_PAYEE } from "./accounts";
import { LOAN_ESCROW_PAYEE, LOAN_INTEREST_PAYEE } from "./loan-balance-update";
import type { PayeeSystem } from "./payees";
import { RECONCILE_ADJUSTMENT_PAYEE } from "./reconcile";
import { REGISTER_STARTING_PAYEE } from "./register";
import { FLAG_NAMES, type FlagColor, isCalendarDate } from "./transactions";

/** The Register text of each system payee, in both directions of the file (export and import). */
export const SYSTEM_PAYEE_NAMES: Record<PayeeSystem, string> = {
  starting_balance: REGISTER_STARTING_PAYEE,
  manual_adjustment: MANUAL_ADJUSTMENT_PAYEE,
  reconciliation_adjustment: RECONCILE_ADJUSTMENT_PAYEE,
  loan_interest: LOAN_INTEREST_PAYEE,
  loan_escrow: LOAN_ESCROW_PAYEE,
};

export const PLAN_HEADER: readonly string[] = [
  "Month",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Assigned",
  "Activity",
  "Available",
];
export const REGISTER_HEADER: readonly string[] = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
];

/**
 * Loan account columns, appended to the Register header only when the plan has a loan account (EXF-991). A plan
 * without one is written exactly as before, and the importer reads either header. They repeat on every row of the
 * loan's account and are empty on other accounts' rows.
 */
export const REGISTER_LOAN_COLUMNS: readonly string[] = [
  "Account Type",
  "Interest Rate",
  "Minimum Payment",
  "Escrow Amount",
  "Paired Category Group",
  "Paired Category",
];
export const REGISTER_LOAN_HEADER: readonly string[] = [
  ...REGISTER_HEADER,
  ...REGISTER_LOAN_COLUMNS,
];

/**
 * Payee renaming rule columns (EXF-885 5a), appended after the loan columns, only when the plan has a live rule. The
 * rules are not part of any transaction, so they ride as rows after the last transaction: every cell before the
 * rule columns empty, then the payee's name, the kind (`is` or `contains`) and the text. Their order in the file is
 * the order of creation. A plan without rules is written exactly as before; an importer that does not know the
 * columns refuses the file at its header, as it does for the loan columns, never reading a rule as a transaction.
 */
export const REGISTER_RULE_COLUMNS: readonly string[] = [
  "Rename Payee",
  "Rename Kind",
  "Rename Text",
];
export const REGISTER_RULES_HEADER: readonly string[] = [
  ...REGISTER_HEADER,
  ...REGISTER_RULE_COLUMNS,
];
export const REGISTER_LOAN_RULES_HEADER: readonly string[] = [
  ...REGISTER_LOAN_HEADER,
  ...REGISTER_RULE_COLUMNS,
];

/**
 * Plan settings file (flag names EXF-480, expected income EXF-525, custom views EXF-502): a third, small file of the
 * zip, written only when the plan has any of that data, so any other plan is written exactly as before. An importer
 * that does not know it skips it (its header is neither the Plan's nor the Register's). One row per fact:
 *  - `Flag Name`: Name = the colour's own name, Value = the plan's name for it;
 *  - `Expected Income`: Value = the amount, in the file's format;
 *  - `Built-in View`: Name = the key (`underfunded`...), Position = its stored place in the views' order (built-ins never moved are not listed);
 *  - `View`: Name = the view's name, Position = its stored place in the same order;
 *  - `View Category`: Name = the view's name, Position = the view's place, then the category's group and name as the
 *    Plan file writes them (a hidden category under `Hidden Categories`); members keep the file's row order.
 */
export const PLAN_SETTINGS_HEADER: readonly string[] = [
  "Setting",
  "Name",
  "Value",
  "Position",
  "Category Group",
  "Category",
];

/** The plan-level data the Settings file carries. `views` is in the views' order, built-ins included. */
export interface SettingsExport {
  flagNames: Partial<Record<FlagColor, string>>;
  expectedIncome: number | null;
  views: readonly {
    /** The view's stored place (`sort_order`); built-ins the plan never moved are not listed. */
    position: number;
    builtinKey: string | null;
    name: string | null;
    categories: readonly { group: string; name: string }[];
  }[];
}

export function hasSettings(s: SettingsExport): boolean {
  return Object.keys(s.flagNames).length > 0 || (s.expectedIncome ?? 0) > 0 || s.views.length > 0;
}

export function settingsFile(s: SettingsExport, fmt: ExportFormat): string {
  const lines: string[] = [PLAN_SETTINGS_HEADER.map(textField).join(fmt.delimiter)];
  const row = (cells: string[]) => lines.push(cells.join(fmt.delimiter));
  const blank = textField("");
  for (const [color, name] of Object.entries(s.flagNames)) {
    row([
      textField("Flag Name"),
      textField(FLAG_NAMES[color as FlagColor]),
      textField(name),
      "",
      blank,
      blank,
    ]);
  }
  if ((s.expectedIncome ?? 0) > 0) {
    row([
      textField("Expected Income"),
      blank,
      fmt.amount(s.expectedIncome as number),
      "",
      blank,
      blank,
    ]);
  }
  for (const v of s.views) {
    const i = v.position;
    if (v.builtinKey !== null) {
      row([textField("Built-in View"), textField(v.builtinKey), blank, String(i), blank, blank]);
      continue;
    }
    const name = textField(v.name ?? "");
    row([textField("View"), name, blank, String(i), blank, blank]);
    for (const c of v.categories) {
      row([
        textField("View Category"),
        name,
        blank,
        String(i),
        textField(c.group),
        textField(c.name),
      ]);
    }
  }
  return delimitedFile(lines);
}

/** One renaming rule as the export writes it. */
export interface RuleExport {
  payee: string;
  kind: string;
  text: string;
}

/** One loan account's fields as the export writes them (the pairing as names; null/empty when none). */
export interface LoanExport {
  type: string;
  interestRate: string | null;
  minimumPayment: number | null;
  escrowAmount: number | null;
  pairedGroup: string | null;
  pairedCategory: string | null;
}

/** A plan's number, currency and date settings (EXF-468 will store them; today the default is used). */
export interface PlanFormat {
  currency_symbol: string;
  /** "none" is Currency Placement "Don't show". */
  symbol_placement: "before" | "after" | "none";
  decimal_separator: string;
  /** Kept for EXF-468; exports never write group separators. */
  group_separator: string;
  decimal_digits: number;
  /** Tokens YYYY, MM, DD. */
  date_format: string;
}

export const DEFAULT_PLAN_FORMAT: PlanFormat = {
  currency_symbol: "$",
  symbol_placement: "before",
  decimal_separator: ".",
  group_separator: ",",
  decimal_digits: 2,
  date_format: "MM/DD/YYYY",
};

export interface ExportFormat {
  amount(milliunits: number): string;
  date(iso: string): string;
  delimiter: "," | "\t";
  extension: "csv" | "tsv";
}

export function exportFormat(f: PlanFormat): ExportFormat {
  const d = f.decimal_digits;
  if (!Number.isInteger(d) || d < 0 || d > 3) throw new RangeError("decimal_digits must be 0..3");
  const step = 10 ** (3 - d);
  const scale = 10 ** d;
  const comma = f.decimal_separator === ",";
  return {
    amount(m) {
      const units = Math.round(Math.abs(m) / step);
      const whole = Math.floor(units / scale);
      const number =
        d > 0
          ? `${whole}${f.decimal_separator}${String(units % scale).padStart(d, "0")}`
          : String(whole);
      const text =
        f.symbol_placement === "before"
          ? f.currency_symbol + number
          : f.symbol_placement === "after"
            ? number + f.currency_symbol
            : number;
      return m < 0 && units > 0 ? `-${text}` : text;
    },
    date(iso) {
      return f.date_format
        .replace("YYYY", iso.slice(0, 4))
        .replace("MM", iso.slice(5, 7))
        .replace("DD", iso.slice(8, 10));
    },
    delimiter: comma ? "\t" : ",",
    extension: comma ? "tsv" : "csv",
  };
}

/** A quoted text field; a value starting (after spaces) with + - = @ is guarded with a backslash. */
export function textField(value: string): string {
  const v = /^\s*[+\-=@]/.test(value) ? `\\${value.replace(/^\s+/, "")}` : value;
  return `"${v.replaceAll('"', '""')}"`;
}

/** BOM, then the lines joined with CRLF; no line end after the last. */
export function delimitedFile(lines: readonly string[]): string {
  return `﻿${lines.join("\r\n")}`;
}

export function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, " ");
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "2026-11-01" -> "Nov 2026". */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export const ExportNow = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "now must be YYYY-MM-DDTHH:mm")
  .refine(
    (s) => {
      const year = Number(s.slice(0, 4));
      return (
        isCalendarDate(s.slice(0, 10)) &&
        year >= 1900 &&
        year <= 2199 &&
        Number(s.slice(11, 13)) <= 23 &&
        Number(s.slice(14, 16)) <= 59
      );
    },
    { message: "now must be a real date and time" },
  );

export const PlanExportQuery = z.object({
  now: ExportNow.optional()
    .describe(
      "The caller's local date and time, YYYY-MM-DDTHH:mm; it names the files and sets the current month. Defaults to the server's UTC time",
    )
    .openapi({ param: { name: "now", in: "query" } }),
});

/** `now` may be at most this many calendar days from the server's UTC date (EXF-670). */
export const EXPORT_NOW_MAX_DAYS = 1;
/** The Plan file never goes past the server's month plus this many months (EXF-670). */
export const EXPORT_MONTHS_AHEAD = 24;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True when the date of `now` is within EXPORT_NOW_MAX_DAYS calendar days of `serverToday`. */
export function nowWithinServerDays(now: string, serverToday: string): boolean {
  const lo = addDays(serverToday, -EXPORT_NOW_MAX_DAYS);
  const hi = addDays(serverToday, EXPORT_NOW_MAX_DAYS);
  const d = now.slice(0, 10);
  return d >= lo && d <= hi;
}

/** "2026-11-15 to 2026-11-17". */
export function nowRangeText(serverToday: string): string {
  return `${addDays(serverToday, -EXPORT_NOW_MAX_DAYS)} to ${addDays(serverToday, EXPORT_NOW_MAX_DAYS)}`;
}

/** The last month the Plan file may hold: the server's month plus EXPORT_MONTHS_AHEAD, as YYYY-MM-01. */
export function exportMonthCeiling(serverToday: string): string {
  const total =
    Number(serverToday.slice(0, 4)) * 12 +
    Number(serverToday.slice(5, 7)) -
    1 +
    EXPORT_MONTHS_AHEAD;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export function utcMinute(at: Date): string {
  return at.toISOString().slice(0, 16);
}

export function exportNames(
  planName: string,
  now: string,
  ext: "csv" | "tsv",
): { zip: string; plan: string; register: string; settings: string } {
  const stamp = `${now.slice(0, 10)} ${now.slice(11, 13)}-${now.slice(14, 16)}`;
  const base = `${safeName(planName)} as of ${stamp}`;
  return {
    zip: `Budget Export - ${base}.zip`,
    plan: `${base} - Plan.${ext}`,
    register: `${base} - Register.${ext}`,
    settings: `${base} - Settings.${ext}`,
  };
}

// ---- Plan file ----

export interface PlanMonthInput {
  month: string;
  groups: readonly {
    name: string;
    hidden: boolean;
    categories: readonly {
      name: string;
      hidden: boolean;
      assigned: number;
      activity: number;
      available: number;
    }[];
  }[];
}

export function planFile(months: readonly PlanMonthInput[], fmt: ExportFormat): string {
  const lines: string[] = [PLAN_HEADER.map(textField).join(fmt.delimiter)];
  for (const m of months) {
    const label = monthLabel(m.month);
    const visible: string[] = [];
    const hidden: string[] = [];
    for (const g of m.groups) {
      for (const c of g.categories) {
        const isHidden = g.hidden || c.hidden;
        const group = isHidden ? "Hidden Categories" : g.name;
        const row = [
          textField(label),
          textField(`${group}: ${c.name}`),
          textField(group),
          textField(c.name),
          fmt.amount(c.assigned),
          fmt.amount(c.activity),
          fmt.amount(c.available),
        ].join(fmt.delimiter);
        (isHidden ? hidden : visible).push(row);
      }
    }
    for (const row of visible) lines.push(row);
    for (const row of hidden) lines.push(row);
  }
  return delimitedFile(lines);
}

// ---- Register file ----

export type CategoryCell =
  | { kind: "none" }
  | { kind: "rta" }
  | { kind: "category"; group: string | null; name: string; hidden: boolean };

export function categoryCell(row: {
  onBudget: boolean;
  categoryId: string | null;
  inflowToRta: boolean;
  known?: { group: string; name: string; hidden: boolean };
  joined: { group: string | null; name: string | null };
}): CategoryCell {
  if (!row.onBudget) return { kind: "none" };
  if (row.categoryId === null) return row.inflowToRta ? { kind: "rta" } : { kind: "none" };
  const k = row.known ?? { group: row.joined.group, name: row.joined.name ?? "", hidden: false };
  return { kind: "category", group: k.group, name: k.name, hidden: k.hidden };
}

export interface RegisterLine {
  payee: string | null;
  memo: string | null;
  amount: number;
  category: CategoryCell;
}

export interface RegisterEntry {
  account: string;
  accountRank: number;
  date: string;
  amount: number;
  payee: string;
  flag: FlagColor | null;
  cleared: "uncleared" | "cleared" | "reconciled";
  memo: string | null;
  category: CategoryCell;
  /** Empty unless the entry is a split. */
  lines: readonly RegisterLine[];
  scheduled: boolean;
  createdAt: string;
  id: string;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Date descending, then signed amount ascending, then account position, transactions before schedules. */
export function compareEntries(a: RegisterEntry, b: RegisterEntry): number {
  return (
    cmp(b.date, a.date) ||
    a.amount - b.amount ||
    a.accountRank - b.accountRank ||
    Number(a.scheduled) - Number(b.scheduled) ||
    cmp(a.createdAt, b.createdAt) ||
    cmp(a.id, b.id)
  );
}

function categoryCells(c: CategoryCell): [string, string, string] {
  if (c.kind === "none") return ["", "", ""];
  if (c.kind === "rta") return ["Inflow: Ready to Assign", "Inflow", "Ready to Assign"];
  if (c.hidden) return [`Hidden Categories: ${c.name}`, "Hidden Categories", c.name];
  if (c.group === null) return [c.name, "", c.name];
  return [`${c.group}: ${c.name}`, c.group, c.name];
}

const CLEARED = { uncleared: "Uncleared", cleared: "Cleared", reconciled: "Reconciled" } as const;

export function registerFile(
  entries: readonly RegisterEntry[],
  fmt: ExportFormat,
  flagLabel: (c: FlagColor) => string = (c) => FLAG_NAMES[c],
  /** Loan accounts by name; when not empty the loan columns are written. */
  loans: ReadonlyMap<string, LoanExport> = new Map(),
  /** Renaming rules in order of creation; when not empty the rule columns and rows are written. */
  rules: readonly RuleExport[] = [],
): string {
  const withLoans = loans.size > 0;
  const withRules = rules.length > 0;
  const header = withLoans
    ? withRules
      ? REGISTER_LOAN_RULES_HEADER
      : REGISTER_LOAN_HEADER
    : withRules
      ? REGISTER_RULES_HEADER
      : REGISTER_HEADER;
  const lines: string[] = [header.map(textField).join(fmt.delimiter)];
  const zero = fmt.amount(0);
  const noLoan = [textField(""), textField(""), "", "", textField(""), textField("")];
  const loanCells = (account: string): string[] => {
    if (!withLoans) return [];
    const l = loans.get(account);
    if (!l) return noLoan;
    return [
      textField(l.type),
      textField(l.interestRate ?? ""),
      l.minimumPayment === null ? "" : fmt.amount(l.minimumPayment),
      l.escrowAmount === null ? "" : fmt.amount(l.escrowAmount),
      textField(l.pairedGroup ?? ""),
      textField(l.pairedCategory ?? ""),
    ];
  };
  const row = (
    e: RegisterEntry,
    payee: string,
    memo: string,
    category: CategoryCell,
    amount: number,
  ) => {
    const [full, group, name] = categoryCells(category);
    return [
      textField(e.account),
      textField(e.flag ? flagLabel(e.flag) : ""),
      textField(fmt.date(e.date)),
      textField(payee),
      textField(full),
      textField(group),
      textField(name),
      textField(memo),
      amount < 0 ? fmt.amount(-amount) : zero,
      amount > 0 ? fmt.amount(amount) : zero,
      textField(CLEARED[e.cleared]),
      ...loanCells(e.account),
      ...(withRules ? [textField(""), textField(""), textField("")] : []),
    ].join(fmt.delimiter);
  };
  for (const e of [...entries].sort(compareEntries)) {
    if (e.lines.length > 0) {
      const n = e.lines.length;
      e.lines.forEach((l, i) => {
        lines.push(
          row(e, l.payee ?? e.payee, `Split (${i + 1}/${n}) ${l.memo ?? ""}`, l.category, l.amount),
        );
      });
    } else {
      lines.push(row(e, e.payee, e.memo ?? "", e.category, e.amount));
    }
  }
  // Rule rows come last: empty up to the rule columns, which tells them from every transaction row.
  const blank = textField("");
  for (const r of rules) {
    const cells = new Array<string>(header.length - REGISTER_RULE_COLUMNS.length).fill(blank);
    cells.push(textField(r.payee), textField(r.kind), textField(r.text));
    lines.push(cells.join(fmt.delimiter));
  }
  return delimitedFile(lines);
}
