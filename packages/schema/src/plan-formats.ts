/**
 * The one formatter for amounts and dates on screens and in files (EXF-468): milliunits and a plan's formats in,
 * text out. Pure; the web app builds one per open plan (`usePlanFormatter`), the Worker one from a plan row.
 * Design: docs/plan-formats-design.md, "Formatter rules".
 */

import { type DateOrder, dateOrder, parseEntryDate } from "./date-entry";
import type { PlanFormat } from "./plan-export";
import {
  type CurrencyFormat,
  type Digits,
  numberFormatParts,
  placementOf,
} from "./plan-formats-catalogue";
import type { DateFormat } from "./plan-import-read";
import { MINUS } from "./screen-money";

export interface PlanFormats {
  currency_format: CurrencyFormat;
  date_format: { format: DateFormat };
}

export const DEFAULT_PLAN_FORMATS: PlanFormats = {
  currency_format: {
    iso_code: "USD",
    example_format: "123,456.78",
    decimal_digits: 2,
    decimal_separator: ".",
    group_separator: ",",
    symbol_first: true,
    currency_symbol: "$",
    display_symbol: true,
  },
  date_format: { format: "MM/DD/YYYY" },
};

export interface PlanFormatter {
  formats: PlanFormats;
  digits: Digits;
  dateFormat: DateFormat;
  /** "−$1,234.56": U+2212 first; a value shown as zero has no sign. Spaces are non-breaking. */
  money(m: number): string;
  /** `+` above zero, else `money`. */
  signed(m: number): string;
  /** `money(|m|)`. */
  abs(m: number): string;
  /** `money` without decimals (chart ticks). */
  whole(m: number): string;
  /** The text of a typed field: no symbol, plain spaces, ASCII minus, every decimal. */
  input(m: number): string;
  /** An ISO date in the plan's date format. */
  date(iso: string): string;
  /** Typed text in the plan's day, month, year order (ISO also accepted) → ISO date, or null. */
  parseDate(text: string, today: string): string | null;
  /** A typed amount with the plan's separators turned into what the parsers read (`.` decimal, no groups). */
  typedAmount(text: string): string;
  /** The plan as `exportFormat` reads it. */
  planFormat(): PlanFormat;
}

const NBSP = " ";

function group(whole: string, indian: boolean, sep: string): string {
  if (whole.length <= 3) return whole;
  const size = indian ? 2 : 3;
  const parts = [whole.slice(-3)];
  let head = whole.slice(0, -3);
  while (head.length > size) {
    parts.unshift(head.slice(-size));
    head = head.slice(0, -size);
  }
  parts.unshift(head);
  return parts.join(sep);
}

export function planFormatter(formats: PlanFormats): PlanFormatter {
  const cf = formats.currency_format;
  const dateFormat = formats.date_format.format;
  const digits = (
    cf.decimal_digits === 0 || cf.decimal_digits === 3 ? cf.decimal_digits : 2
  ) as Digits;
  const order: DateOrder = dateOrder(dateFormat);
  const { indian } = numberFormatParts(cf.example_format);

  function number(m: number, d: number, sep: string): { text: string; units: number } {
    const step = 10 ** (3 - d);
    const scale = 10 ** d;
    const units = Math.round(Math.abs(m) / step);
    const whole = group(String(Math.floor(units / scale)), indian, sep);
    const text =
      d > 0 ? `${whole}${cf.decimal_separator}${String(units % scale).padStart(d, "0")}` : whole;
    return { text, units };
  }

  function write(m: number, d: number): string {
    const { text, units } = number(m, d, cf.group_separator);
    const symbol = cf.currency_symbol;
    const body = !cf.display_symbol ? text : cf.symbol_first ? symbol + text : text + symbol;
    return `${m < 0 && units > 0 ? MINUS : ""}${body}`.replaceAll(" ", NBSP);
  }

  const money = (m: number) => write(m, digits);
  const formatter: PlanFormatter = {
    formats,
    digits,
    dateFormat,
    money,
    signed: (m) => {
      const { units } = number(m, digits, "");
      return m > 0 && units > 0 ? `+${money(m)}` : money(m);
    },
    abs: (m) => money(Math.abs(m)),
    whole: (m) => write(m, 0),
    input(m) {
      const { text, units } = number(m, digits, cf.group_separator);
      return `${m < 0 && units > 0 ? "-" : ""}${text}`;
    },
    date: (iso) =>
      dateFormat
        .replace("YYYY", iso.slice(0, 4))
        .replace("MM", iso.slice(5, 7))
        .replace("DD", iso.slice(8, 10)),
    parseDate: (text, today) => parseEntryDate(text, today, order),
    typedAmount(text) {
      const groupSep = cf.group_separator;
      const decimal = cf.decimal_separator;
      if (decimal === "." && groupSep === ",") return text;
      let t = text.replaceAll(cf.currency_symbol.trim() || "\u0000", "");
      t = t.replace(/[\s ]/g, "");
      if (groupSep !== "-" && groupSep !== "/") t = t.split(groupSep.trim() || "\u0000").join("");
      if (digits === 0) return t;
      if (decimal === ",") return t.replaceAll(",", ".");
      if (decimal === "-" || decimal === "/") {
        const re = new RegExp(`^[-−]?\\d+[-/]\\d{1,${digits}}$`);
        if (re.test(t)) {
          const i = Math.max(t.lastIndexOf("-"), t.lastIndexOf("/"));
          return `${t.slice(0, i)}.${t.slice(i + 1)}`;
        }
      }
      return t;
    },
    planFormat: () => ({
      currency_symbol: cf.currency_symbol,
      symbol_placement: placementOf(cf),
      decimal_separator: cf.decimal_separator,
      group_separator: cf.group_separator,
      decimal_digits: cf.decimal_digits,
      date_format: dateFormat,
    }),
  };
  return formatter;
}

export const DEFAULT_FORMATTER: PlanFormatter = planFormatter(DEFAULT_PLAN_FORMATS);
