import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { enterDue } from "../src/services/scheduled-transactions";
import { freshOk, n, seedSource } from "./fresh-start-helpers";

const entered = (bid: string) =>
  n(
    "select count(*) n from transactions where budget_id = ? and payee_name is not 'Starting Balance' and deleted_at is null",
    bid,
  );
const dueRun = (ids: string[]) =>
  enterDue(env, { budgetIds: ids, day: "2026-09-30", actor: "service:scheduler" });

describe("Fresh Start: the archive's schedules (EXF-478 follow-up)", () => {
  it("the archive enters nothing after a Fresh Start; the new plan enters as before", async () => {
    const src = await seedSource();
    const { new_budget_id: nb, archived_budget_id: ob } = await freshOk(src.bid, `ZZ-TEST new`);
    const live = await n(
      "select count(*) n from scheduled_transactions where budget_id = ? and deleted_at is null",
      ob,
    );
    expect(live).toBeGreaterThan(0);
    // several due dates pass
    for (let i = 0; i < 3; i++) await dueRun([ob, nb]);
    expect(await entered(ob)).toBe(0);
    expect(await entered(nb)).toBeGreaterThan(0);
    // the archive's schedules stay live and untouched (dormant, not ended)
    expect(
      await n(
        "select count(*) n from scheduled_transactions where budget_id = ? and deleted_at is null and date_next = '2026-03-20'",
        ob,
      ),
    ).toBe(live);
  });

  it("a plan that was never archived is unaffected", async () => {
    const src = await seedSource();
    await dueRun([src.bid]);
    expect(await entered(src.bid)).toBeGreaterThan(0);
  });
});
