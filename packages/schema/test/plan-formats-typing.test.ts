import { describe, expect, it } from "vitest";
import { evaluateAmountEntry } from "../src/amount-entry";
import { parseAmountInput } from "../src/amount-input";
import { evaluateAssigned } from "../src/assigned-edit";
import { dateOrder, parseEntryDate } from "../src/date-entry";
import { DEFAULT_FORMATTER, type PlanFormatter, planFormatter } from "../src/plan-formats";
import { currencyFormatOf, type Placement } from "../src/plan-formats-catalogue";

const make = (
  code: string,
  nf: string,
  p: Placement = "before",
  date = "MM/DD/YYYY",
): PlanFormatter =>
  planFormatter({
    currency_format: currencyFormatOf(code, nf, p),
    date_format: { format: date as never },
  });
const amount = (f: PlanFormatter, text: string) =>
  evaluateAmountEntry(f.typedAmount(text), f.digits);

describe("typed amounts read the plan's separators", () => {
  it("1.234,56 in a 123.456,78 plan is 1,234,560", () => {
    const f = make("EUR", "123.456,78");
    expect(amount(f, "1.234,56")).toBe(1234560);
    expect(evaluateAssigned(f.typedAmount("1.234,56"), 0, f.digits)).toBe(1234560);
    expect(parseAmountInput(f.typedAmount("€1.234,56"), f.digits)).toBe(1234560);
  });
  it("space groups and comma decimals", () => {
    expect(amount(make("PLN", "123 456,78"), "1 234,56")).toBe(1234560);
  });
  it("1500 in a yen plan is 1,500,000; 1.500 in an XPF plan too", () => {
    expect(amount(make("JPY", "123,456"), "1500")).toBe(1500000);
    expect(amount(make("XPF", "123.456", "after"), "1.500")).toBe(1500000);
    expect(parseAmountInput("1500", 0)).toBe(1500000);
    expect(parseAmountInput("1500.5", 0)).toBeNull();
  });
  it("1,234.567 in a dinar plan is 1,234,567", () => {
    const f = make("KWD", "123,456.789", "none");
    expect(amount(f, "1,234.567")).toBe(1234567);
    expect(parseAmountInput("1234.567", 3)).toBe(1234567);
  });
  it("12-50 in 123 456-78 is 12,500", () => {
    expect(amount(make("USD", "123 456-78", "none"), "12-50")).toBe(12500);
  });
  it("arithmetic keeps working", () => {
    expect(amount(make("EUR", "123.456,78"), "1.234,56+10")).toBe(1244560);
    // With "-" as the decimal point, a text that is not just number-separator-digits keeps its operators.
    expect(amount(make("USD", "123 456-78", "none"), "10-50+1")).toBe(39000);
  });
  it("the default format is untouched", () => {
    for (const t of ["1,234.50", "$12", "12.5", "3*4", "(1+2)*3"]) {
      expect(DEFAULT_FORMATTER.typedAmount(t)).toBe(t);
    }
    expect(amount(DEFAULT_FORMATTER, "1,234.50")).toBe(1234500);
    expect(evaluateAmountEntry("1,234.50")).toBe(1234500);
  });
});

describe("typed dates read the plan's order", () => {
  const today = "2026-11-17";
  it("30.12.2026 in DD.MM.YYYY is 2026-12-30 and 12/30/2026 is refused", () => {
    const f = make("USD", "123,456.78", "before", "DD.MM.YYYY");
    expect(f.parseDate("30.12.2026", today)).toBe("2026-12-30");
    expect(f.parseDate("12/30/2026", today)).toBeNull();
    expect(f.parseDate("30.12", today)).toBe("2026-12-30");
  });
  it("YYYY/MM/DD", () => {
    const f = make("USD", "123,456.78", "before", "YYYY/MM/DD");
    expect(f.parseDate("2026/12/30", today)).toBe("2026-12-30");
    expect(f.parseDate("26/12/30", today)).toBeNull();
  });
  it("ISO is accepted in every order", () => {
    for (const d of ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY.MM.DD"]) {
      expect(make("USD", "123,456.78", "before", d).parseDate("2026-12-30", today)).toBe(
        "2026-12-30",
      );
    }
  });
  it("today's month-day-year tests are unchanged", () => {
    expect(parseEntryDate("12/30/2026", today)).toBe("2026-12-30");
    expect(parseEntryDate("12/30", today)).toBe("2026-12-30");
    expect(parseEntryDate("12", today)).toBe("2026-12-01");
    expect(dateOrder("DD-MM-YYYY")).toBe("DMY");
  });
  it("shows the format as its placeholder source", () => {
    expect(make("USD", "123,456.78", "before", "DD.MM.YYYY").dateFormat).toBe("DD.MM.YYYY");
  });
});
