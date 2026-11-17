import { formatMoney } from "../../core/src/money";
import { describe, expect, it } from "vitest";
import { formatAssignedInput } from "../src/assigned-edit";
import { DEFAULT_FORMATTER, type PlanFormatter, planFormatter } from "../src/plan-formats";
import {
  currencyFormatOf,
  DATE_FORMAT_OPTIONS,
  type Placement,
} from "../src/plan-formats-catalogue";
import { reportMoney, usDate } from "../src/reflect-format";
import { screenMoney } from "../src/screen-money";

const N = " "; // the non-breaking space screens use
const make = (code: string, nf: string, p: Placement, date = "MM/DD/YYYY"): PlanFormatter =>
  planFormatter({
    currency_format: currencyFormatOf(code, nf, p),
    date_format: { format: date as never },
  });

describe("default formatter equals today's functions", () => {
  const values = [
    0, 10, -10, 1000, -1000, 1234560, -1234560, 12345678900, -50000, 990, 4560, -123450,
  ];
  it("screenMoney, plan money, reportMoney, formatAssignedInput", () => {
    for (const v of values) {
      expect(DEFAULT_FORMATTER.money(v)).toBe(screenMoney(v));
      expect(DEFAULT_FORMATTER.money(v)).toBe(formatMoney(v).replace("-", "−"));
      expect(DEFAULT_FORMATTER.money(v)).toBe(reportMoney(v));
      expect(DEFAULT_FORMATTER.input(v)).toBe(formatAssignedInput(v));
      expect(DEFAULT_FORMATTER.abs(v)).toBe(formatMoney(Math.abs(v)));
    }
  });
  it("dates", () => {
    expect(DEFAULT_FORMATTER.date("2026-12-30")).toBe(usDate("2026-12-30"));
    expect(DEFAULT_FORMATTER.date("2026-01-05")).toBe("01/05/2026");
  });
});

describe("formatter rules (note 10)", () => {
  it("figures", () => {
    expect(DEFAULT_FORMATTER.money(1234560)).toBe("$1,234.56");
    expect(make("EUR", "123.456,78", "after").money(1234560)).toBe("1.234,56€");
    expect(make("EUR", "123.456,78", "after").money(-1234560)).toBe("−1.234,56€");
    expect(make("CHF", "123'456.78", "before").money(1234560)).toBe(`CHF${N}1'234.56`);
    expect(make("USD", "123 456-78", "none").money(1234560)).toBe(`1${N}234-56`);
    expect(make("USD", "123,456/78", "none").money(1234560)).toBe("1,234/56");
    expect(make("JPY", "123,456", "before").money(1234560)).toBe("¥1,235");
    expect(make("JPY", "123,456", "before").money(1234000)).toBe("¥1,234");
    expect(make("USD", "1,23,456.78", "none").money(12345678900)).toBe("1,23,45,678.90");
    expect(make("KWD", "123,456.789", "none").money(1234567)).toBe("1,234.567");
    expect(DEFAULT_FORMATTER.money(-4)).toBe("$0.00");
  });
  it("sign, signed, abs, whole, input", () => {
    const eur = make("EUR", "123.456,78", "after");
    expect(eur.signed(5000)).toBe("+5,00€");
    expect(eur.signed(-5000)).toBe("−5,00€");
    expect(eur.signed(0)).toBe("0,00€");
    expect(eur.abs(-5000)).toBe("5,00€");
    expect(eur.whole(1234560)).toBe("1.235€");
    expect(eur.input(-1234560)).toBe("-1.234,56");
    expect(make("JPY", "123,456", "before").money(-500)).toBe("−¥1");
    expect(make("JPY", "123,456", "before").money(-499)).toBe("¥0");
  });
  it("spaces in symbols and separators never break an amount", () => {
    expect(make("USD", "123 456.78", "before").money(1234560000)).toBe(`$1${N}234${N}560.00`);
    expect(make("PLN", "123 456,78", "after").money(1000)).toBe(`1,00${N}zł`);
  });
  it("dates in the seven formats", () => {
    const got = DATE_FORMAT_OPTIONS.map((f) =>
      make("USD", "123,456.78", "before", f).date("2026-12-30"),
    );
    expect(got).toEqual([
      "2026/12/30",
      "2026-12-30",
      "30-12-2026",
      "30/12/2026",
      "30.12.2026",
      "12/30/2026",
      "2026.12.30",
    ]);
  });
  it("typed amounts", () => {
    expect(make("EUR", "123.456,78", "before").typedAmount("1.234,56")).toBe("1234.56");
    expect(make("USD", "123 456,78", "before").typedAmount("1 234,56")).toBe("1234.56");
    expect(make("USD", "123 456-78", "before").typedAmount("12-50")).toBe("12.50");
    expect(make("EUR", "123.456,78", "before").typedAmount("1.234,56+10")).toBe("1234.56+10");
    expect(DEFAULT_FORMATTER.typedAmount("$1,234.56")).toBe("$1,234.56");
  });
  it("planFormat for files", () => {
    expect(make("EUR", "123.456,78", "after", "DD.MM.YYYY").planFormat()).toEqual({
      currency_symbol: "€",
      symbol_placement: "after",
      decimal_separator: ",",
      group_separator: ".",
      decimal_digits: 2,
      date_format: "DD.MM.YYYY",
    });
  });
});
