import { SCHEDULED_MAX_RUNS } from "@budget/schema/plaid-import";
import { dayBefore } from "@budget/schema/recurrence";
import { SCHEDULER_ACTOR, SCHEDULER_CRON_CALLS } from "@budget/schema/scheduled-transactions";
import type { Env } from "./env";
import { requestSync, syncDueConnections } from "./services/plaid-sync";
import { enterDue } from "./services/scheduled-transactions";

/**
 * The scheduled job, every six hours (03, 09, 15, 21 UTC): enter what is due, then the bank sync. The scheduler's day is the day before the server's
 * UTC date, which has begun everywhere on earth, so it never enters a transaction dated in the owner's
 * future. Its D1 calls (at most SCHEDULER_CRON_CALLS) come off the sync's budget of runs.
 */
export async function cronRun(
  env: Env,
  now: Date = new Date(),
  run: typeof requestSync = requestSync,
): Promise<void> {
  try {
    await enterDue(env, {
      budgetIds: "all",
      day: dayBefore(now.toISOString().slice(0, 10)),
      actor: SCHEDULER_ACTOR,
    });
  } catch (e) {
    // A failed scheduler never stops the bank sync.
    console.error("scheduler failed", e);
  }
  await syncDueConnections(env, now, run, { maxRuns: SCHEDULED_MAX_RUNS - SCHEDULER_CRON_CALLS });
}

// TODO: nightly backup Build (export to R2) hooks in here.
export async function scheduled(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const run = cronRun(env);
  ctx.waitUntil(run);
  await run;
}
