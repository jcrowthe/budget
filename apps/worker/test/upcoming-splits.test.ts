import { describe, expect, it } from "vitest";
import { account as openAccount } from "./account-helpers";
import { api, type Json, send } from "./category-helpers";
import { NOV, seedPlan, TODAY } from "./plan-fixtures";
import { sched } from "./scheduled-helpers";

// EXF-501 part 2: each line of a split schedule counts toward its own category; the parent counts nowhere.
const read = async (bid: string, path: string) =>
  ((await (await send("GET", api(bid, path))).json()) as Json).data as Json;
const month = async (bid: string) => read(bid, `/months/${NOV}?today=${TODAY}`);
const cat = (m: Json, id: string): Json =>
  m.groups.flatMap((g: Json) => g.categories).find((c: Json) => c.id === id);

async function world() {
  const s = await seedPlan(["ZZ-TEST Fun", "ZZ-TEST Food", "ZZ-TEST Other"]);
  const fun = s.ids["ZZ-TEST Fun"] as string;
  const food = s.ids["ZZ-TEST Food"] as string;
  const other = s.ids["ZZ-TEST Other"] as string;
  const checking = (await openAccount(s.bid, "checking", 0, "ZZ-TEST Checking")).id as string;
  return { ...s, fun, food, other, checking };
}
const mk = (a: string, lines: Json[], extra: Json = {}) => ({
  account_id: a,
  date_first: "2026-11-22",
  frequency: "monthly",
  amount: lines.reduce((t, l) => t + l.amount, 0),
  subtransactions: lines,
  ...extra,
});

describe("upcoming with split schedules", () => {
  it("each line counts toward its own category; the parent counts nowhere", async () => {
    const w = await world();
    await sched(
      w.bid,
      mk(w.checking, [
        { amount: -30000, category_id: w.fun },
        { amount: -10000, category_id: w.food },
      ]),
    );
    const m = await month(w.bid);
    expect(cat(m, w.fun)).toMatchObject({ upcoming: -30000, upcoming_count: 1 });
    expect(cat(m, w.food)).toMatchObject({ upcoming: -10000, upcoming_count: 1 });
    expect(cat(m, w.other)).toMatchObject({ upcoming: 0, upcoming_count: 0 });
  });

  it("a Ready to Assign line and an uncategorized line count nowhere", async () => {
    const w = await world();
    await sched(
      w.bid,
      mk(w.checking, [
        { amount: -30000, category_id: w.fun },
        { amount: 5000, category_id: null, inflow_to_ready_to_assign: true },
        { amount: -2000 },
      ]),
    );
    const m = await month(w.bid);
    expect(cat(m, w.fun)).toMatchObject({ upcoming: -30000, upcoming_count: 1 });
    expect(cat(m, w.food).upcoming).toBe(0);
  });

  it("two lines in one category merge into one occurrence", async () => {
    const w = await world();
    const made = (
      await sched(
        w.bid,
        mk(
          w.checking,
          [
            { amount: -30000, category_id: w.fun, memo: "ZZ-TEST first" },
            { amount: -10000, category_id: w.fun, memo: "ZZ-TEST second" },
            { amount: -500, category_id: w.food },
          ],
          { payee_name: "ZZ-TEST Parent Payee" },
        ),
      )
    ).scheduled_transaction;
    const m = await month(w.bid);
    expect(cat(m, w.fun)).toMatchObject({ upcoming: -40000, upcoming_count: 1 });
    const list = await read(w.bid, `/months/${NOV}/categories/${w.fun}/upcoming?today=${TODAY}`);
    expect(list.occurrences).toHaveLength(1);
    expect(list.occurrences[0]).toMatchObject({
      scheduled_transaction_id: made.id,
      amount: -40000,
      memo: "ZZ-TEST first",
      payee_name: "ZZ-TEST Parent Payee",
    });
  });

  it("a deleted line category counts nowhere", async () => {
    const w = await world();
    await sched(
      w.bid,
      mk(w.checking, [
        { amount: -30000, category_id: w.fun },
        { amount: -10000, category_id: w.food },
      ]),
    );
    expect((await send("DELETE", api(w.bid, `/categories/${w.food}`))).status).toBe(200);
    const m = await month(w.bid);
    expect(cat(m, w.fun)).toMatchObject({ upcoming: -30000, upcoming_count: 1 });
  });
});
