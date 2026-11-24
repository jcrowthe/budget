import { describe, expect, it } from "vitest";
import {
  type CategoryMode,
  type CategoryValue,
  compareRecency,
  effectiveDefault,
  nextDefault,
  PAYEE_CATEGORY_MODES,
  RECENCY_ORDER,
} from "../src/payee-category";

const cat = (id: string): CategoryValue => ({ category_id: id, inflow_to_ready_to_assign: false });
const RTA: CategoryValue = { category_id: null, inflow_to_ready_to_assign: true };
const Fun = cat("fun");
const Groceries = cat("groceries");
const Rent = cat("rent");
const Phone = cat("phone");

type Entry = { date: string; value: CategoryValue };

/** Enters the rows one at a time (entry order = created_at), keeping the stored default current after each. */
function replay(entries: Entry[], start: CategoryValue | null = null): CategoryValue | null {
  const rows: { date: string; created_at: string; id: string; value: CategoryValue }[] = [];
  let current = start;
  for (const [i, e] of entries.entries()) {
    rows.push({ ...e, created_at: String(i).padStart(4, "0"), id: `r${i}` });
    const last3 = [...rows].sort(compareRecency).slice(0, 3).map((r) => r.value);
    current = nextDefault(current, last3);
  }
  return current;
}

describe("the history rule (EXF-515 ticket table)", () => {
  it("Cafe A: 11/15 Fun, 11/15 Fun → Fun", () => {
    expect(
      replay([
        { date: "2026-11-15", value: Fun },
        { date: "2026-11-15", value: Fun },
      ]),
    ).toEqual(Fun);
  });

  it("Cafe A: then 11/15 Groceries ×2 (last 3: Fun, Fun, Groceries) → Fun", () => {
    expect(
      replay([
        { date: "2026-11-15", value: Fun },
        { date: "2026-11-15", value: Fun },
        { date: "2026-11-15", value: Groceries },
        { date: "2026-11-15", value: Groceries },
      ]),
    ).toEqual(Fun);
  });

  it("Cafe C: Groceries 11/10, Groceries 11/11, Fun 11/12 → Groceries", () => {
    expect(
      replay([
        { date: "2026-11-10", value: Groceries },
        { date: "2026-11-11", value: Groceries },
        { date: "2026-11-12", value: Fun },
      ]),
    ).toEqual(Groceries);
  });

  it("Cafe D: Groceries 11/10, Fun 11/12 → Groceries (a tie keeps)", () => {
    expect(
      replay([
        { date: "2026-11-10", value: Groceries },
        { date: "2026-11-12", value: Fun },
      ]),
    ).toEqual(Groceries);
  });

  it("Cafe D: then Rent 11/13 (3-way tie) → Groceries", () => {
    expect(
      replay([
        { date: "2026-11-10", value: Groceries },
        { date: "2026-11-12", value: Fun },
        { date: "2026-11-13", value: Rent },
      ]),
    ).toEqual(Groceries);
  });

  it("Cafe E: Fun 11/12 entered first, then Groceries 11/10 → Fun", () => {
    expect(
      replay([
        { date: "2026-11-12", value: Fun },
        { date: "2026-11-10", value: Groceries },
      ]),
    ).toEqual(Fun);
  });

  it("Phone Co: history Phone, fixed Fun → Fun", () => {
    const stored = replay([{ date: "2026-11-10", value: Phone }]);
    expect(stored).toEqual(Phone);
    expect(effectiveDefault("fixed", Fun, stored)).toEqual(Fun);
  });

  it("Cafe A: off → null", () => {
    expect(effectiveDefault("off", Fun, Fun)).toBeNull();
  });
});

describe("the history rule: other cases", () => {
  it("one Fun row gives Fun", () => {
    expect(replay([{ date: "2026-11-10", value: Fun }])).toEqual(Fun);
  });

  it("Ready to Assign is a value: two RTA inflows give RTA", () => {
    expect(
      replay([
        { date: "2026-11-10", value: RTA },
        { date: "2026-11-11", value: RTA },
      ]),
    ).toEqual(RTA);
  });

  it("a current default that is not live and no majority takes the most recent value", () => {
    expect(nextDefault(null, [Fun, Groceries, Rent])).toEqual(Fun);
  });

  it("no rows and no live current give null", () => {
    expect(nextDefault(null, [])).toBeNull();
  });

  it("a live current is kept when the last 3 are empty", () => {
    expect(nextDefault(Fun, [])).toEqual(Fun);
  });

  it("a majority beats the current default", () => {
    expect(nextDefault(Fun, [Groceries, Groceries, Fun])).toEqual(Groceries);
  });

  it("effectiveDefault: a fixed choice whose category is gone reads null; history gives the stored value", () => {
    expect(effectiveDefault("fixed", null, Fun)).toBeNull();
    expect(effectiveDefault("history", Fun, Groceries)).toEqual(Groceries);
    expect(effectiveDefault("history", null, null)).toBeNull();
  });

  it("the recency order is date desc, created_at asc, id asc, from one constant", () => {
    expect(RECENCY_ORDER).toEqual([
      { column: "date", dir: "desc" },
      { column: "created_at", dir: "asc" },
      { column: "id", dir: "asc" },
    ]);
    const rows = [
      { date: "2026-11-10", created_at: "b", id: "1" },
      { date: "2026-11-12", created_at: "z", id: "2" },
      { date: "2026-11-10", created_at: "a", id: "9" },
      { date: "2026-11-10", created_at: "a", id: "3" },
    ];
    expect([...rows].sort(compareRecency).map((r) => r.id)).toEqual(["2", "3", "9", "1"]);
  });

  it("the CategoryMode values", () => {
    expect(PAYEE_CATEGORY_MODES).toEqual(["history", "fixed", "off"]);
    const m: CategoryMode = "off";
    expect(m).toBe("off");
  });
});
