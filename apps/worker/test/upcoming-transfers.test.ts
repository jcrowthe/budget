import { describe, expect, it } from "vitest";
import { account as openAccount } from "./account-helpers";
import { api, type Json, send } from "./category-helpers";
import { NOV, seedPlan, TODAY } from "./plan-fixtures";
import { sched } from "./scheduled-helpers";

// EXF-501: a transfer schedule counts in Upcoming on its on-plan side only; a transfer between on-plan
// accounts has no category and counts nowhere.
const read = async (bid: string, path: string) =>
  ((await (await send("GET", api(bid, path))).json()) as Json).data as Json;
const month = async (bid: string) => read(bid, `/months/${NOV}?today=${TODAY}`);
const cats = (m: Json): Json[] => m.groups.flatMap((g: Json) => g.categories);
const figures = (m: Json) =>
  JSON.stringify(cats(m).map((c) => [c.id, c.upcoming, c.upcoming_count]));

async function world() {
  const s = await seedPlan(["ZZ-TEST Fun"]);
  const fun = s.ids["ZZ-TEST Fun"] as string;
  const checking = (await openAccount(s.bid, "checking", 0, "ZZ-TEST Checking")).id as string;
  const savings = (await openAccount(s.bid, "savings", 0, "ZZ-TEST Savings")).id as string;
  const tracking = (await openAccount(s.bid, "otherAsset", 0, "ZZ-TEST Tracking")).id as string;
  return { ...s, fun, checking, savings, tracking };
}
const mk = (a: string, b: string, extra: Json = {}) => ({
  account_id: a,
  transfer_account_id: b,
  date_first: "2026-11-22",
  frequency: "monthly",
  amount: -50000,
  ...extra,
});

describe("upcoming with transfer schedules", () => {
  it("an on-plan to on-plan transfer counts toward no category", async () => {
    const w = await world();
    const before = await month(w.bid);
    await sched(w.bid, mk(w.checking, w.savings));
    const after = await month(w.bid);
    expect(figures(after)).toBe(figures(before));
    expect(after.uncategorized ?? null).toEqual(before.uncategorized ?? null);
    expect(after.ready_to_assign).toBe(before.ready_to_assign);
  });

  it("on-plan to tracking counts on the on-plan side, with the category", async () => {
    const w = await world();
    await sched(w.bid, mk(w.checking, w.tracking, { category_id: w.fun }));
    const c = cats(await month(w.bid)).find((x) => x.id === w.fun) as Json;
    expect(c.upcoming).toBe(-50000);
    expect(c.upcoming_count).toBe(1);
  });

  it("tracking to on-plan counts the on-plan side's inflow, naming the on-plan account", async () => {
    const w = await world();
    await sched(w.bid, mk(w.tracking, w.checking, { category_id: w.fun }));
    const c = cats(await month(w.bid)).find((x) => x.id === w.fun) as Json;
    expect(c.upcoming).toBe(50000);
    expect(c.upcoming_count).toBe(1);
    const list = await read(w.bid, `/months/${NOV}/categories/${w.fun}/upcoming?today=${TODAY}`);
    expect(list.occurrences).toHaveLength(1);
    expect(list.occurrences[0].account_name).toBe("ZZ-TEST Checking");
    expect(list.occurrences[0].amount).toBe(50000);
  });

  it("a closed other account stops the transfer counting", async () => {
    const w = await world();
    await sched(w.bid, mk(w.checking, w.tracking, { category_id: w.fun }));
    const closed = await send("POST", api(w.bid, `/accounts/${w.tracking}/close`), {});
    expect(closed.status).toBe(200);
    const c = cats(await month(w.bid)).find((x) => x.id === w.fun) as Json;
    expect(c.upcoming).toBe(0);
    expect(c.upcoming_count).toBe(0);
  });
});
