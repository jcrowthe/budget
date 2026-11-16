import { describe, expect, it } from "vitest";
import {
  dayOfMonthOptions,
  draftFromTarget,
  draftToBody,
  newDraft,
  unitOptions,
  WEEKDAYS,
  yearOptions,
} from "../src/target-form";
import type { TargetDefinition } from "../src/targets";

const TODAY = "2026-11-15";
const def = (o: Partial<TargetDefinition>): TargetDefinition => ({
  cadence: "monthly",
  behavior: "set_aside",
  amount: 100000,
  day_of_week: null,
  day_of_month: null,
  due_date: null,
  due_month: null,
  repeat: null,
  created_on: "2026-11-01",
  ...o,
});

describe("target form", () => {
  it("defaults follow the browser's date", () => {
    expect(newDraft("2026-11-15")).toMatchObject({
      tab: "monthly",
      amount: 0,
      dayOfWeek: 6,
      dayOfMonth: null,
      yearlyDate: "12/01/2026",
      customDate: "12/01/2026",
      dueMonth: 11,
      dueYear: 2026,
    });
    expect(newDraft("2026-12-31")).toMatchObject({
      yearlyDate: "01/01/2027",
      dueMonth: 0,
      dueYear: 2027,
    });
    const years = yearOptions("2026-12-31");
    expect([years[0], years[49], years.length]).toEqual([2026, 2075, 50]);
  });

  const kinds: [string, Partial<TargetDefinition>][] = [
    ["weekly set aside", { cadence: "weekly", amount: 25000, day_of_week: 2 }],
    ["weekly refill", { cadence: "weekly", behavior: "refill", day_of_week: 6 }],
    ["monthly last day", {}],
    ["monthly refill day 10", { behavior: "refill", day_of_month: 10 }],
    ["yearly", { cadence: "yearly", due_date: "2027-10-31" }],
    ["yearly refill", { cadence: "yearly", behavior: "refill", due_date: "2027-03-05" }],
    ["custom set aside", { cadence: "custom", due_date: "2027-01-31" }],
    [
      "custom fill up repeat",
      {
        cadence: "custom",
        behavior: "fill_up",
        due_date: "2027-01-31",
        repeat: { every: 3, unit: "year" },
      },
    ],
    ["custom balance dated", { cadence: "custom", behavior: "balance", due_month: "2027-04-01" }],
    ["custom balance eventually", { cadence: "custom", behavior: "balance" }],
  ];
  it.each(kinds)("round trip: %s", (_, o) => {
    const d = def(o);
    const r = draftToBody(draftFromTarget(d, TODAY), TODAY);
    if (!("body" in r)) throw new Error("no body");
    const { created_on: _c, ...rest } = d;
    for (const [k, v] of Object.entries(r.body)) {
      expect(v ?? null, k).toEqual((rest as Record<string, unknown>)[k] ?? null);
    }
    expect(r.body.cadence).toBe(d.cadence);
    expect(r.body.behavior).toBe(d.behavior);
  });

  it("reports errors", () => {
    expect(draftToBody({ ...newDraft(TODAY), amount: 0 }, TODAY)).toEqual({
      errors: { amount: "Enter an amount greater than $0.00." },
    });
    expect(
      draftToBody(
        { ...newDraft(TODAY), amount: 1000, tab: "yearly", yearlyDate: "13/45/2026" },
        TODAY,
      ),
    ).toEqual({ errors: { date: "Enter a valid date." } });
  });

  it("balance without a date and no repeat are explicit nulls", () => {
    const b = draftToBody(
      { ...newDraft(TODAY), amount: 1000, tab: "custom", custom: "balance" },
      TODAY,
    );
    expect(b).toEqual({
      body: { cadence: "custom", behavior: "balance", amount: 1000, due_month: null },
    });
    const c = draftToBody({ ...newDraft(TODAY), amount: 1000, tab: "custom" }, TODAY);
    expect(c).toMatchObject({ body: { due_date: "2026-12-01", repeat: null } });
  });

  it("option lists", () => {
    expect(unitOptions(1).map((o) => o.label)).toEqual(["Month", "Year"]);
    expect(unitOptions(3).map((o) => o.label)).toEqual(["Months", "Years"]);
    const dom = dayOfMonthOptions();
    expect([dom[0]?.label, dom[1]?.label, dom[31]?.label, dom[2]?.label]).toEqual([
      "Last Day of Month",
      "31st",
      "1st",
      "30th",
    ]);
    expect(WEEKDAYS[0]).toBe("Sunday");
    expect(WEEKDAYS[6]).toBe("Saturday");
  });
});
