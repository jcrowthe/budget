/**
 * Import Plan, the reading half: delimited text, the formula guard, amounts, dates, file names and the
 * identification of the Plan and Register files. Pure. Design: docs/plan-import-design.md.
 */
import {
  PLAN_HEADER,
  REGISTER_HEADER,
  REGISTER_LOAN_HEADER,
  REGISTER_LOAN_RULES_HEADER,
  REGISTER_RULES_HEADER,
} from "./plan-export";
import { isCalendarDate } from "./transactions";

export type ImportErrorCode =
  | "not_recognized"
  | "not_utf8"
  | "bad_amount"
  | "bad_date"
  | "bad_month"
  | "date_format_unclear"
  | "too_large"
  | "bad_option";

/** The file cannot be read as a plan export; the API answers 422 with this message. */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export const DATE_FORMATS = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "YYYY/MM/DD",
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "DD.MM.YYYY",
  "YYYY.MM.DD",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface NamedText {
  name: string;
  text: string;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** TAB for a `.tsv`, else whichever delimiter gives at least 7 fields (the Plan file's width). */
export function sniffDelimiter(header: string, fileName: string): "," | "\t" {
  if (/\.tsv$/i.test(fileName)) return "\t";
  const line = header.split(/\r?\n/, 1)[0] ?? "";
  const width = (d: "," | "\t") => {
    try {
      return readDelimited(line, d)[0]?.length ?? 0;
    } catch {
      return 0;
    }
  };
  if (width(",") >= 7) return ",";
  if (width("\t") >= 7) return "\t";
  return ",";
}

/**
 * RFC 4180 records: quoted fields with doubled quotes and line breaks inside, CRLF or LF between records.
 * One pass over the indices; fields are slices, never built character by character.
 */
export function readDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  const n = text.length;
  const d = delimiter.charCodeAt(0);
  let i = 0;
  while (i < n) {
    const row: string[] = [];
    for (;;) {
      let field: string;
      if (text.charCodeAt(i) === 34) {
        let j = i + 1;
        let escaped = false;
        let close: number;
        for (;;) {
          close = text.indexOf('"', j);
          if (close < 0)
            throw new ImportError("not_recognized", "The file has a quote that is never closed");
          if (text.charCodeAt(close + 1) === 34) {
            escaped = true;
            j = close + 2;
          } else break;
        }
        field = text.slice(i + 1, close);
        if (escaped) field = field.replaceAll('""', '"');
        i = close + 1;
        // Stray text after the closing quote stays in the field.
        let k = i;
        while (k < n) {
          const c = text.charCodeAt(k);
          if (c === d || c === 10 || c === 13) break;
          k++;
        }
        if (k > i) {
          field += text.slice(i, k);
          i = k;
        }
      } else {
        let k = i;
        while (k < n) {
          const c = text.charCodeAt(k);
          if (c === d || c === 10 || c === 13) break;
          k++;
        }
        field = text.slice(i, k);
        i = k;
      }
      row.push(field);
      if (i >= n) break;
      const c = text.charCodeAt(i);
      if (c === d) {
        i++;
        if (i >= n) {
          row.push("");
          break;
        }
        continue;
      }
      if (c === 13 && text.charCodeAt(i + 1) === 10) i += 2;
      else i++;
      break;
    }
    if (row.length === 1 && row[0] === "") continue;
    rows.push(row);
  }
  return rows;
}

/** A text field written by the export as `\` + one of `+ - = @` loses the backslash. */
export function unguard(field: string): string {
  return /^\\[+\-=@]/.test(field) ? field.slice(1) : field;
}

export interface ParsedAmount {
  milliunits: number;
  symbol: string;
  placement: "before" | "after" | "none";
  /** The decimal separator, null when the amount has none. */
  separator: string | null;
  /** Digits after the separator. */
  digits: number;
  /** The grouping (thousands) character, null when the amount has none. */
  grouping: string | null;
}

const isDigit = (c: number) => c >= 48 && c <= 57;

/** The characters read as thousands grouping once the decimal separator is known. */
export const GROUPING_CHARS: readonly string[] = [",", ".", " ", "\u00a0", "\u202f", "'", "\u2019"];
const DECIMAL_CHARS = [".", ",", "-", "/"];

function numberSpan(cell: string): { s: string; first: number; last: number } | null {
  const s = cell.trim();
  let first = -1;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    if (isDigit(s.charCodeAt(i))) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  // A decimal point written straight before the first digit (`.50`, `-$.99`) belongs to the number,
  // unless a letter precedes it (`Rs.50`: the point ends the symbol).
  const lead = s[first - 1];
  if ((lead === "." || lead === ",") && !/\p{L}/u.test(s[first - 2] ?? "")) first--;
  return { s, first, last };
}

/**
 * The decimal separator an amount cell reveals, or null: two different non-digits where the last occurs once and is
 * a decimal character, or one non-digit occurring once followed by 1 or 2 digits.
 */
export function detectDecimal(cell: string): string | null {
  const sp = numberSpan(cell);
  if (!sp) return null;
  const number = sp.s.slice(sp.first, sp.last + 1);
  const seps: string[] = [];
  for (let i = 0; i < number.length; i++)
    if (!isDigit(number.charCodeAt(i))) seps.push(number[i] as string);
  if (seps.length === 0) return null;
  const lastSep = seps[seps.length - 1] as string;
  if (seps.length === 1) {
    const frac = number.length - number.lastIndexOf(lastSep) - 1;
    return frac >= 1 && frac <= 2 ? lastSep : null;
  }
  const distinct = new Set(seps);
  if (
    distinct.size >= 2 &&
    seps.filter((c) => c === lastSep).length === 1 &&
    DECIMAL_CHARS.includes(lastSep)
  ) {
    return lastSep;
  }
  return null;
}

/**
 * `-$45.00` → -45000, `120,50€` → 120500, `¥1234` → 1234000; null for anything else.
 * With `decimal` (the file's decimal separator) grouped amounts are read too: `$1,234.56`, `1.234,56€`.
 * Without it, exactly the plain rule.
 */
export function parseAmount(cell: string, decimal?: string | null): ParsedAmount | null {
  const sp = numberSpan(cell);
  if (!sp) return null;
  const { s, first, last } = sp;
  let before = s.slice(0, first).trim();
  const after = s.slice(last + 1).trim();
  const negative = before.startsWith("-");
  if (negative) before = before.slice(1).trim();
  if (before !== "" && after !== "") return null;
  const number = s.slice(first, last + 1);
  let separator: string | null = null;
  let grouping: string | null = null;
  let whole = number;
  let frac = "";
  const seps: string[] = [];
  for (let i = 0; i < number.length; i++)
    if (!isDigit(number.charCodeAt(i))) seps.push(number[i] as string);
  const grouped = (g: string, d: string | null): boolean => {
    if (g === d || !GROUPING_CHARS.includes(g)) return false;
    let intPart = number;
    if (d !== null) {
      const at = number.lastIndexOf(d);
      intPart = number.slice(0, at);
      frac = number.slice(at + 1);
      if (frac.length < 1 || frac.length > 3 || !/^\d+$/.test(frac)) return false;
    }
    const groups = intPart.split(g);
    if (groups.length < 2) return false;
    if (!groups.every((x) => /^\d+$/.test(x))) return false;
    if ((groups[0] as string).length > 3) return false;
    if (!groups.slice(1).every((x) => x.length === 3)) return false;
    whole = groups.join("");
    grouping = g;
    separator = d;
    return true;
  };
  let done = false;
  if (decimal) {
    if (seps.length === 1) {
      const g = seps[0] as string;
      const frac3 = number.length - number.indexOf(g) - 1 === 3;
      if (g !== decimal && frac3 && grouped(g, null)) {
        // `1,234` in a `.` file is grouping; `1.234` in a `.` file stays a three-decimal amount.
        separator = null;
        frac = "";
        done = true;
      } else {
        frac = "";
      }
    } else if (seps.length > 1) {
      const g = seps[0] as string;
      const d =
        seps[seps.length - 1] === decimal && seps.filter((c) => c === decimal).length === 1
          ? decimal
          : null;
      const used = d === null ? seps : seps.slice(0, -1);
      if (g === decimal || !used.every((c) => c === g) || !grouped(g, d)) return null;
      done = true;
    }
  }
  if (!done) {
    whole = number;
    frac = "";
    separator = null;
    for (let i = 0; i < number.length; i++) {
      if (!isDigit(number.charCodeAt(i))) {
        if (separator !== null) return null;
        separator = number[i] as string;
        whole = number.slice(0, i);
        frac = number.slice(i + 1);
      }
    }
    if (separator !== null && (frac.length < 1 || frac.length > 3)) return null;
  }
  if (whole === "" && separator !== null && frac !== "") whole = "0";
  if (whole.length > 12 || whole === "" || frac.length > 3) return null;
  const units = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  const symbol = before !== "" ? before : after;
  return {
    milliunits: negative && units !== 0 ? -units : units,
    symbol,
    placement: before !== "" ? "before" : after !== "" ? "after" : "none",
    separator,
    digits: frac.length,
    grouping,
  };
}

function dateParts(text: string, fmt: DateFormat): { y: string; m: string; d: string } | null {
  const sep = fmt.includes("/") ? "/" : fmt.includes("-") ? "-" : ".";
  const parts = text.split(sep);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts as [string, string, string];
  const digits = (x: string, min: number, max: number) =>
    x.length >= min && x.length <= max && /^\d+$/.test(x);
  switch (fmt) {
    case "MM/DD/YYYY":
      return digits(a, 1, 2) && digits(b, 1, 2) && digits(c, 4, 4) ? { y: c, m: a, d: b } : null;
    case "DD/MM/YYYY":
    case "DD-MM-YYYY":
    case "DD.MM.YYYY":
      return digits(a, 1, 2) && digits(b, 1, 2) && digits(c, 4, 4) ? { y: c, m: b, d: a } : null;
    default:
      return digits(a, 4, 4) && digits(b, 1, 2) && digits(c, 1, 2) ? { y: a, m: b, d: c } : null;
  }
}

export function parseDate(text: string, fmt: DateFormat): string | null {
  const p = dateParts(text.trim(), fmt);
  if (!p) return null;
  const iso = `${p.y}-${p.m.padStart(2, "0")}-${p.d.padStart(2, "0")}`;
  const year = Number(p.y);
  if (year < 1900 || year > 2199 || !isCalendarDate(iso)) return null;
  return iso;
}

/** Every format that parses every text, in DATE_FORMATS order. */
export function dateCandidates(texts: readonly string[]): DateFormat[] {
  const unique = [...new Set(texts)];
  return DATE_FORMATS.filter((f) => unique.every((t) => parseDate(t, f) !== null));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 2026" → "2026-11-01". */
export function parseMonthLabel(text: string): string | null {
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(text.trim());
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1] as string);
  if (idx < 0) return null;
  return `${m[2]}-${String(idx + 1).padStart(2, "0")}-01`;
}

/** `… Export - <SafeName> as of YYYY-MM-DD HH-mm …` (a path and extension may surround it). */
export function parseExportName(name: string): { name: string; exportDate: string } | null {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const m = /(?:^|Export - )([A-Za-z0-9 ]*?) as of (\d{4}-\d{2}-\d{2}) \d{2}-\d{2}/.exec(base);
  if (!m) return null;
  const plan = (m[1] as string).trim();
  const date = m[2] as string;
  if (plan === "" || !isCalendarDate(date)) return null;
  return { name: plan, exportDate: date };
}

const NOT_RECOGNIZED = "Give the ZIP from Export Plan, or its Plan and Register files";

function headerOf(file: NamedText): { fields: string[]; delimiter: "," | "\t" } | null {
  const text = stripBom(file.text);
  const line = text.slice(
    0,
    Math.max(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n")),
  );
  const delimiter = sniffDelimiter(line, file.name);
  try {
    return { fields: readDelimited(line, delimiter)[0] ?? [], delimiter };
  } catch {
    return null;
  }
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Exactly one Plan and one Register file, told apart by their header row, not their names. */
export function identifyFiles(files: readonly NamedText[]): {
  plan: NamedText;
  register: NamedText;
  delimiter: "," | "\t";
  planDelimiter: "," | "\t";
} {
  let plan: { file: NamedText; delimiter: "," | "\t" } | null = null;
  let register: { file: NamedText; delimiter: "," | "\t" } | null = null;
  for (const file of files) {
    const h = headerOf(file);
    if (!h) continue;
    const clean = h.fields.map((f) => f.trim());
    if (same(clean, PLAN_HEADER)) {
      if (plan) throw new ImportError("not_recognized", NOT_RECOGNIZED);
      plan = { file, delimiter: h.delimiter };
    } else if (
      same(clean, REGISTER_HEADER) ||
      same(clean, REGISTER_LOAN_HEADER) ||
      same(clean, REGISTER_RULES_HEADER) ||
      same(clean, REGISTER_LOAN_RULES_HEADER)
    ) {
      if (register) throw new ImportError("not_recognized", NOT_RECOGNIZED);
      register = { file, delimiter: h.delimiter };
    }
  }
  if (!plan || !register) throw new ImportError("not_recognized", NOT_RECOGNIZED);
  return {
    plan: plan.file,
    register: register.file,
    delimiter: register.delimiter,
    planDelimiter: plan.delimiter,
  };
}
