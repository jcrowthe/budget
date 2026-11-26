// Pure helpers of the register search box (EXF-528): the segment being typed, its suggestions, and the
// query the register sends (only the segments that can be read, so a half-typed `Is: unc` never gets a 422).

import {
  flagOptions,
  formatToken,
  IS_OPTIONS,
  MAX_SEARCH_LENGTH,
  MAX_SEARCH_TOKENS,
  parseAmount,
  parseSearch,
  type SearchToken,
} from "@budget/schema/transaction-search";
import type { FlagNames } from "@budget/schema/transactions";

export type SearchCtx = {
  dateFormat: string;
  today: string;
  /** The plan's custom flag names (EXF-480). */
  flagNames?: Partial<FlagNames> | null;
  money: (milliunits: number) => string;
  date: (iso: string) => string;
  parseDate: (text: string, today: string) => string | null;
};

export type Suggestion = {
  key: string;
  /** The grey label on the left (`Payee:`); empty for the any-field entry. */
  label: string;
  description: string;
  /** The token text written into the box, or null for an entry that only explains. */
  write: string | null;
};

/** The text before the segment being typed (`"Is: Uncleared, "`), and that segment, trimmed. */
export function splitCurrent(text: string): { head: string; current: string } {
  const i = text.lastIndexOf(",");
  if (i < 0) return { head: "", current: text.trim() };
  return { head: `${text.slice(0, i).trimEnd()}, `, current: text.slice(i + 1).trim() };
}

/** The box's text after choosing `write` for the current segment. */
export const withChoice = (text: string, write: string) => `${splitCurrent(text).head}${write}, `;

const labelAndValue = (cur: string): { label: string; value: string } | null => {
  const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(cur);
  return m ? { label: (m[1] as string).toLowerCase(), value: (m[2] as string).trim() } : null;
};

const hasSep = (cur: string) => /[/.-]/.test(cur);

/** The suggestions for what is typed after the last comma: context entries first, then the four "Find" ones. */
export function suggestions(
  current: string,
  ctx: SearchCtx,
  categories: readonly string[],
  accounts: readonly string[],
): Suggestion[] {
  const cur = current.trim();
  if (!cur) return [];
  const lc = cur.toLowerCase();
  const lv = labelAndValue(cur);
  const out: Suggestion[] = [];
  const add = (label: string, description: string, write: string | null) =>
    out.push({ key: `${label}${description}`, label, description, write });
  const has = (name: string, needle: string) => name.toLowerCase().includes(needle.toLowerCase());

  // Categories: `cat` lists them all; otherwise the names that contain the text.
  const catNeedle = lv?.label === "category" ? lv.value : lc;
  const allCats =
    lv?.label === "category" ? lv.value === "" : lc.length >= 2 && "category".startsWith(lc);
  for (const name of categories) {
    if (allCats || (catNeedle && has(name, catNeedle))) add("Category:", name, `Category: ${name}`);
  }
  // Accounts.
  if (lv?.label === "account" || (lc.length >= 3 && "account".startsWith(lc))) {
    for (const name of accounts) {
      if (lv?.label !== "account" || !lv.value || has(name, lv.value)) {
        add("Account:", name, `Account: ${name}`);
      }
    }
  }
  // Flags, then Is options; a word inside a label also finds it (`red`, `cleared`, `needs`).
  const flagNeedle = lv?.label === "flag" ? lv.value : lv ? null : lc;
  if (lv?.label === "flag" || (!lv && lc.length >= 2 && "flag".startsWith(lc))) {
    for (const f of flagOptions(ctx.flagNames)) {
      if (lv?.label !== "flag" || !lv.value || has(f, lv.value)) add("Flag:", f, `Flag: ${f}`);
    }
  } else if (flagNeedle && flagNeedle.length >= 3) {
    for (const f of flagOptions(ctx.flagNames))
      if (has(f, flagNeedle)) add("Flag:", f, `Flag: ${f}`);
  }
  if (lv?.label === "is" || lc === "is") {
    for (const o of IS_OPTIONS) {
      if (!lv || !lv.value || has(o, lv.value)) add("Is:", o, `Is: ${o}`);
    }
  } else if (!lv && lc.length >= 3) {
    for (const o of IS_OPTIONS) if (has(o, lc)) add("Is:", o, `Is: ${o}`);
  }
  // A date.
  if (!lv && hasSep(cur)) {
    const iso = ctx.parseDate(cur, ctx.today);
    if (iso) {
      const when = ctx.date(iso);
      const desc = {
        on: `On ${when}`,
        before: `On or before ${when}`,
        after: `On or after ${when}`,
      };
      for (const op of ["on", "before", "after"] as const) {
        const w = formatToken({ type: "date", op, date: iso }, ctx.dateFormat, ctx.flagNames);
        add(`${op[0]?.toUpperCase()}${op.slice(1)}:`, desc[op], w);
      }
    }
  }
  // An amount.
  const amount = lv ? null : parseAmount(cur);
  if (amount) {
    const shown = ctx.money(amount.milliunits);
    for (const side of ["outflow", "inflow"] as const) {
      const name = `${side[0]?.toUpperCase()}${side.slice(1)}`;
      const t = (op: "eq" | "gte" | "lte"): SearchToken => ({
        type: "amount",
        side,
        op,
        milliunits: amount.milliunits,
      });
      add(
        `${name}:`,
        `${name} equals ${shown}`,
        formatToken(t("eq"), ctx.dateFormat, ctx.flagNames),
      );
      add(
        `${name}:`,
        `${name} more or equal to ${shown}`,
        formatToken(t("gte"), ctx.dateFormat, ctx.flagNames),
      );
      add(
        `${name}:`,
        `${name} less or equal to ${shown}`,
        formatToken(t("lte"), ctx.dateFormat, ctx.flagNames),
      );
    }
    add("Income:", "Enter month like 'Income: November 2026'", null);
  }
  // Always offered.
  const q = cur;
  add("", `Find "${q}" in any field`, q);
  add("Payee:", `Find "${q}" in the Payee`, `Payee: ${q}`);
  add("Category:", `Find "${q}" in the Category`, `Category: ${q}`);
  add("Memo:", `Find "${q}" in the Memo`, `Memo: ${q}`);
  return out;
}

/** The query to send: the readable tokens of `text`, written canonically; "" when there are none. */
export function appliedOf(
  text: string,
  ctx: Pick<SearchCtx, "dateFormat" | "today" | "flagNames">,
) {
  const { tokens } = parseSearch(text, ctx);
  return keep(tokens, ctx.dateFormat, ctx.flagNames);
}

function keep(tokens: SearchToken[], dateFormat: string, flagNames?: Partial<FlagNames> | null) {
  const parts: string[] = [];
  let length = 0;
  for (const t of tokens.slice(0, MAX_SEARCH_TOKENS)) {
    const s = formatToken(t, dateFormat, flagNames);
    if (length + s.length + 2 > MAX_SEARCH_LENGTH) break;
    parts.push(s);
    length += s.length + 2;
  }
  return parts.join(", ");
}

/** The first token as written, for the footer. */
export function firstTokenText(
  applied: string,
  ctx: Pick<SearchCtx, "dateFormat" | "today" | "flagNames">,
) {
  const t = parseSearch(applied, ctx).tokens[0];
  return t ? formatToken(t, ctx.dateFormat, ctx.flagNames) : applied;
}
