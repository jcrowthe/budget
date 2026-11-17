import { describe, expect, it } from "vitest";
import {
  cents,
  debtsMoney,
  drillAmount,
  drillTitle,
  longMonthLabel,
  minusMoney,
  niceTicks,
  reportMoney,
  signedChange,
  tickMoney,
} from "../src/reflect-format";

describe("zero is never negative (EXF-591)", () => {
  it.each([0, -0, -4, 4, -1])("%s milliunits", (m) => {
    for (const f of [reportMoney, debtsMoney, signedChange, drillAmount]) {
      expect(f(m)).toBe("$0.00");
    }
    expect(tickMoney(m)).toBe("$0");
  });
  it("keeps the sign of a real figure", () => {
    expect(debtsMoney(-4750000)).toBe("−$4,750.00");
    expect(debtsMoney(4750000)).toBe("−$4,750.00");
    expect(signedChange(-55000)).toBe("−$55.00");
    expect(signedChange(3300000)).toBe("+$3,300.00");
    expect(reportMoney(-12849260)).toBe("−$12,849.26");
    expect(drillAmount(-150000)).toBe("−$150.00");
    expect(drillAmount(20000)).toBe("+$20.00");
    expect(tickMoney(-5000000)).toBe("−$5,000");
  });
  it("rounds cents half away from zero", () => {
    expect(cents(5)).toBe(1);
    expect(cents(-5)).toBe(-1);
    expect(Object.is(cents(-0), 0)).toBe(true);
  });
});

describe("niceTicks", () => {
  const vals = [0, 1, 400, 999, 1000, 1500, 24049260, 5000000];
  const mins = [...vals.map((v) => -v), 0];
  it("never repeats a tick or a label and covers the range", () => {
    const pairs: [number, number][] = [];
    for (const a of mins) for (const b of vals) if (a <= b) pairs.push([a, b]);
    for (let i = 0; i < 300; i++) {
      const a = -Math.floor(Math.random() * 3e7) * (i % 2);
      pairs.push([a, a + Math.floor(Math.random() * 10 ** (1 + (i % 8)))]);
    }
    for (const [lo, hi] of pairs) {
      const t = niceTicks(lo, hi);
      if (lo === 0 && hi === 0) {
        expect(t).toEqual([]);
        continue;
      }
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(5);
      expect(new Set(t).size).toBe(t.length);
      expect(new Set(t.map((v) => tickMoney(v))).size).toBe(t.length);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1] as number);
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi);
      expect(t.every((v) => !Object.is(v, -0))).toBe(true);
    }
  });
  it("matches the examples", () => {
    expect(niceTicks(0, 400)).toEqual([0, 1000]);
    expect(niceTicks(-400, 0)).toEqual([-1000, 0]);
    expect(niceTicks(0, 24049260)).toEqual([0, 10000000, 20000000, 30000000]);
  });
});

describe("trends and income formats", () => {
  it("minusMoney uses U+2212 only below zero cents", () => {
    expect(minusMoney(-120000)).toBe("−$120.00");
    expect(minusMoney(-4)).toBe("$0.00");
    expect(minusMoney(3000000)).toBe("$3,000.00");
  });
  it("longMonthLabel and drillTitle", () => {
    expect(longMonthLabel("2026-11-01")).toBe("November 2026");
    expect(drillTitle("D8 Food", "2026-10-01")).toBe("D8 Food–OCT 2026");
    expect(drillTitle("D8 Food", null)).toBe("D8 Food");
  });
});
