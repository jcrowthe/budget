import { describe, expect, it } from "vitest";
import { buildImportPlan, type PlanImportOptions } from "../src/plan-import";

// EXF-501: a paired transfer after the export date is one transfer schedule, kept on its outflow side.
const PH =
  '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"';
const RH =
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';
const PLAN = [
  PH,
  '"Oct 2026","Bills: Rent","Bills","Rent",$900.00,-$900.00,$0.00',
  '"Nov 2026","Bills: Rent","Bills","Rent",$900.00,$0.00,$900.00',
].join("\r\n");
const build = (rows: string[], options: PlanImportOptions = {}) =>
  buildImportPlan({
    plan: { name: "ZZ-TEST as of 2026-11-15 19-51 - Plan.csv", text: PLAN },
    register: {
      name: "ZZ-TEST as of 2026-11-15 19-51 - Register.csv",
      text: [RH, ...rows].join("\r\n"),
    },
    delimiter: ",",
    zipName: null,
    options,
    serverToday: "2026-11-16",
  });
const accountOf = (p: ReturnType<typeof build>, name: string) =>
  p.accounts.findIndex((a) => a.name === name);

describe("a paired future transfer becomes one schedule", () => {
  it("on-plan to on-plan: on the outflow side, no category, no real rows", () => {
    const p = build([
      '"A","","12/20/2026","Transfer : B","","","","ZZ-TEST rent",$100.00,$0.00,"Uncleared"',
      '"B","","12/20/2026","Transfer : A","","","","ZZ-TEST rent",$0.00,$100.00,"Uncleared"',
    ]);
    expect(p.schedules).toHaveLength(1);
    const s = p.schedules[0] as (typeof p.schedules)[number];
    expect(s).toMatchObject({
      account: accountOf(p, "A"),
      transferAccount: accountOf(p, "B"),
      payee: null,
      category: null,
      inflowToRta: false,
      memo: "ZZ-TEST rent",
      amount: -100000,
      date: "2026-12-20",
    });
    expect(p.transactions.filter((t) => t.date === "2026-12-20")).toHaveLength(0);
    expect(p.counts).toMatchObject({ transfers_paired: 0, scheduled: 1 });
    expect(p.warnings.map((w) => w.code)).not.toContain("scheduled_not_supported");
  });

  it("the outflow side wins whichever row comes first", () => {
    const p = build([
      '"B","","12/20/2026","Transfer : A","","","","",$0.00,$100.00,"Uncleared"',
      '"A","","12/20/2026","Transfer : B","","","","",$100.00,$0.00,"Uncleared"',
    ]);
    expect(p.schedules).toHaveLength(1);
    expect(p.schedules[0]?.account).toBe(accountOf(p, "A"));
  });

  it("on-plan to tracking puts the on-plan row's category on the schedule", () => {
    const p = build(
      [
        '"A","","12/20/2026","Transfer : T","Bills: Rent","Bills","Rent","",$100.00,$0.00,"Uncleared"',
        '"T","","12/20/2026","Transfer : A","","","","",$0.00,$100.00,"Uncleared"',
        '"T","","12/21/2026","Transfer : A","","","","",$50.00,$0.00,"Uncleared"',
        '"A","","12/21/2026","Transfer : T","Bills: Rent","Bills","Rent","",$0.00,$50.00,"Uncleared"',
      ],
      { account_types: { T: "otherAsset" } },
    );
    expect(p.schedules).toHaveLength(2);
    const [out, back] = p.schedules;
    expect(out).toMatchObject({ account: accountOf(p, "A"), transferAccount: accountOf(p, "T") });
    expect(out?.category).not.toBeNull();
    // tracking to on-plan: the schedule sits on the tracking account and carries the on-plan row's category
    expect(back).toMatchObject({ account: accountOf(p, "T"), transferAccount: accountOf(p, "A") });
    expect(back?.category).toBe(out?.category);
  });
});
