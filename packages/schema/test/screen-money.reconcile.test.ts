import { describe, expect, it } from "vitest";
import { DEFAULT_FORMATTER } from "../src/plan-formats";
import { debtsMoney, drillAmount, minusMoney, reportMoney, tickMoney } from "../src/reflect-format";
import { MINUS } from "../src/screen-money";

const screenMoney = DEFAULT_FORMATTER.money;

describe("screenMoney (EXF-664)", () => {
  it("writes the minus sign U+2212 before the dollar sign, never a hyphen", () => {
    expect(screenMoney(-444000)).toBe("−$444.00");
    expect(screenMoney(-1234567890)).toBe("−$1,234,567.89");
    expect(screenMoney(1234500)).toBe("$1,234.50");
    expect(screenMoney(0)).toBe("$0.00");
    expect(screenMoney(-4)).toBe("$0.00");
    for (const m of [-444000, -1234567890, -4, 0, 1234500])
      expect(screenMoney(m)).not.toContain("-");
    expect(MINUS.charCodeAt(0)).toBe(0x2212);
  });

  it("Reflect's helpers write it too", () => {
    for (const text of [
      reportMoney(-55000),
      debtsMoney(4750000),
      drillAmount(-150000),
      tickMoney(-5000000),
      minusMoney(-120000),
    ]) {
      expect(text.startsWith(MINUS)).toBe(true);
      expect(text).not.toContain("-");
    }
  });
});
