// The register search grammar (EXF-528): `Payee: corner, Is: Uncleared, Outflow: >=20`. Pure and free of I/O.
// The Worker turns the tokens into SQL; the web uses them for suggestions, the token text, hiding split lines
// and leaving out the segment the person is still typing.

import { dateOrder, parseEntryDate } from "./date-entry";
import { FLAG_COLORS, FLAG_NAMES, type FlagColor } from "./transactions";

export const IS_OPTIONS = [
  "Uncleared",
  "Cleared",
  "Reconciled",
  "Unreconciled",
  "Cleared or Reconciled",
  "Matched",
  "Approved",
  "Unapproved",
  "Needs Category",
  "Unapproved or Needs Category",
] as const;
export type IsValue = (typeof IS_OPTIONS)[number];

/** `None` first, then the flags in the flag menu's order. */
export const FLAG_OPTIONS: readonly string[] = ["None", ...FLAG_COLORS.map((c) => FLAG_NAMES[c])];

export const MAX_SEARCH_TOKENS = 10;
export const MAX_SEARCH_LENGTH = 500;

export type TextField = "any" | "payee" | "category" | "memo" | "account";
export type SearchToken =
  | { type: "text"; field: TextField; value: string }
  | { type: "flag"; color: FlagColor | null }
  | { type: "is"; value: IsValue }
  | { type: "date"; op: "on" | "before" | "after"; date: string }
  | { type: "amount"; side: "outflow" | "inflow"; op: "eq" | "gte" | "lte"; milliunits: number }
  | { type: "income"; month: string };

export const SEARCH_LABELS = [
  "payee",
  "category",
  "memo",
  "account",
  "flag",
  "is",
  "on",
  "before",
  "after",
  "outflow",
  "inflow",
  "income",
] as const;

export const SEARCH_QUERY_DESCRIPTION =
  "Search text: segments separated by commas, all of which must match. A segment is free text (matches the payee, category, memo or account name, case-insensitive) or `Label: value` with the label Payee, Category, Memo, Account (contains the text), Flag (None, Red, Orange, Yellow, Green, Blue, Purple), Is (Uncleared, Cleared, Reconciled, Unreconciled, Cleared or Reconciled, Matched, Approved, Unapproved, Needs Category, Unapproved or Needs Category), On, Before, After (a date in the plan's date format or YYYY-MM-DD; Before and After include the day), Outflow or Inflow (an amount such as `20`, `>=20` or `<=20`) or Income (`Income: November 2026`: Ready to Assign inflows of that month). A split transaction matches when it or any of its lines matches. Up to 10 segments and 500 characters; a segment that cannot be read is a 422.";

export type SearchContext = { dateFormat: string; today: string };
export type ParsedSearch = {
  tokens: SearchToken[];
  invalid: { segment: string; reason: string }[];
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const AMOUNT = /^(>=|<=)?\s*[^\d\s]?\s*(\d+(?:\.\d{1,3})?)$/;

export function parseAmount(
  value: string,
): { op: "eq" | "gte" | "lte"; milliunits: number } | null {
  const m = AMOUNT.exec(value.trim());
  if (!m) return null;
  const [whole = "0", frac = ""] = (m[2] as string).split(".");
  const milliunits = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  if (!Number.isSafeInteger(milliunits)) return null;
  return { op: m[1] === ">=" ? "gte" : m[1] === "<=" ? "lte" : "eq", milliunits };
}

function parseSegment(
  label: string,
  value: string,
  ctx: SearchContext,
): SearchToken | { error: string } {
  const ci = (list: readonly string[]) => list.find((o) => o.toLowerCase() === value.toLowerCase());
  switch (label) {
    case "payee":
    case "category":
    case "memo":
    case "account":
      return { type: "text", field: label, value };
    case "flag": {
      const f = ci(FLAG_OPTIONS);
      if (!f) return { error: `Flag must be one of ${FLAG_OPTIONS.join(", ")}` };
      const color = FLAG_COLORS.find((c) => FLAG_NAMES[c] === f);
      return { type: "flag", color: color ?? null };
    }
    case "is": {
      const v = ci(IS_OPTIONS);
      return v
        ? { type: "is", value: v as IsValue }
        : { error: `Is must be one of ${IS_OPTIONS.join(", ")}` };
    }
    case "on":
    case "before":
    case "after": {
      const parts = value.split(/[/.-]/);
      const date =
        parts.length >= 2 ? parseEntryDate(value, ctx.today, dateOrder(ctx.dateFormat)) : null;
      return date
        ? { type: "date", op: label, date }
        : {
            error: `${label[0]?.toUpperCase()}${label.slice(1)} needs a date such as ${ctx.dateFormat}`,
          };
    }
    case "outflow":
    case "inflow": {
      const a = parseAmount(value);
      return a
        ? { type: "amount", side: label, ...a }
        : { error: "an amount such as 20, >=20 or <=20 is needed" };
    }
    default: {
      const m = /^([a-z]+)\s+(\d{4})$/i.exec(value);
      const i = m ? MONTHS.indexOf((m[1] as string).toLowerCase()) : -1;
      return m && i >= 0
        ? { type: "income", month: `${m[2]}-${String(i + 1).padStart(2, "0")}-01` }
        : { error: "Income needs a month such as November 2026" };
    }
  }
}

/** Splits at commas; `label: value` for a known label, otherwise free text. An empty value is skipped. */
export function parseSearch(q: string, ctx: SearchContext): ParsedSearch {
  const tokens: SearchToken[] = [];
  const invalid: ParsedSearch["invalid"] = [];
  for (const raw of q.split(",")) {
    const segment = raw.trim();
    if (!segment) continue;
    const colon = segment.indexOf(":");
    const label = colon > 0 ? segment.slice(0, colon).trim().toLowerCase() : "";
    if (!(SEARCH_LABELS as readonly string[]).includes(label)) {
      tokens.push({ type: "text", field: "any", value: segment });
      continue;
    }
    const value = segment.slice(colon + 1).trim();
    if (!value) continue;
    const t = parseSegment(label, value, ctx);
    if ("error" in t) invalid.push({ segment, reason: t.error });
    else tokens.push(t);
  }
  if (tokens.length + invalid.length > MAX_SEARCH_TOKENS) {
    invalid.push({ segment: q.slice(0, 40), reason: `at most ${MAX_SEARCH_TOKENS} segments` });
  }
  return { tokens, invalid };
}

/** ISO date in a plan's date format (`MM/DD/YYYY`, `DD.MM.YYYY`, …). */
export function formatIsoDate(iso: string, dateFormat: string): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  return dateFormat.replace("YYYY", y).replace("MM", m).replace("DD", d);
}

/** The amount as typed: `20`, `20.5`, `20.005`. */
function amountText(milliunits: number): string {
  const whole = Math.floor(milliunits / 1000);
  const frac = String(milliunits % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

const cap = (s: string) => `${s[0]?.toUpperCase()}${s.slice(1)}`;

/** The token as the search box writes it, without the trailing `, `. */
export function formatToken(token: SearchToken, dateFormat: string): string {
  switch (token.type) {
    case "text":
      return token.field === "any" ? token.value : `${cap(token.field)}: ${token.value}`;
    case "flag":
      return `Flag: ${token.color ? FLAG_NAMES[token.color] : "None"}`;
    case "is":
      return `Is: ${token.value}`;
    case "date":
      return `${cap(token.op)}: ${formatIsoDate(token.date, dateFormat)}`;
    case "amount": {
      const op = token.op === "gte" ? ">=" : token.op === "lte" ? "<=" : "";
      return `${cap(token.side)}: ${op}${amountText(token.milliunits)}`;
    }
    case "income": {
      const month = MONTHS[Number(token.month.slice(5, 7)) - 1] ?? "";
      return `Income: ${cap(month)} ${token.month.slice(0, 4)}`;
    }
  }
}

export type SearchLine = {
  amount: number;
  category_name: string | null;
  memo: string | null;
  payee_name?: string | null;
};
export type SearchParent = { payee_name: string | null; account_name?: string | null };

const has = (hay: string | null | undefined, needle: string) =>
  (hay ?? "").toLowerCase().includes(needle.toLowerCase());

/**
 * Whether one split line matches: text, category, memo and amount are the line's (its payee falls back to the
 * parent's); every other token belongs to the parent, so it holds for each line (the parent has been listed).
 */
export function lineMatches(
  tokens: readonly SearchToken[],
  line: SearchLine,
  parent: SearchParent,
) {
  const payee = line.payee_name ?? parent.payee_name;
  return tokens.every((t) => {
    if (t.type === "text") {
      if (t.field === "account") return has(parent.account_name, t.value) || !parent.account_name;
      if (t.field === "payee") return has(payee, t.value);
      if (t.field === "category") return has(line.category_name, t.value);
      if (t.field === "memo") return has(line.memo, t.value);
      return (
        has(payee, t.value) ||
        has(line.category_name, t.value) ||
        has(line.memo, t.value) ||
        has(parent.account_name, t.value)
      );
    }
    if (t.type === "amount") {
      const a = t.side === "outflow" ? -line.amount : line.amount;
      if (a <= 0) return false;
      return t.op === "eq"
        ? a === t.milliunits
        : t.op === "gte"
          ? a >= t.milliunits
          : a <= t.milliunits;
    }
    return true;
  });
}
