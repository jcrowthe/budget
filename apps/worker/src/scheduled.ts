import { BACKUP_CRON } from "@budget/schema/backup";
import { SCHEDULED_MAX_RUNS } from "@budget/schema/plaid-import";
import { dayBefore } from "@budget/schema/recurrence";
import { SCHEDULER_ACTOR, SCHEDULER_CRON_CALLS } from "@budget/schema/scheduled-transactions";
import type { Env } from "./env";
import { describeError, LOG_LINE_MAX } from "./middleware/errors";
import { backupRun } from "./services/backup";
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
    console.error(`scheduler failed | ${describeError(e)}`.slice(0, LOG_LINE_MAX));
  }
  await syncDueConnections(env, now, run, { maxRuns: SCHEDULED_MAX_RUNS - SCHEDULER_CRON_CALLS });
}

/**
 * Two crons. The six-hourly one runs `cronRun`, as does any call without a cron. BACKUP_CRON (04:00 to 04:55 UTC)
 * runs the nightly backup alone, in its own invocation: it takes no call or run from enterDue or the sync
 * (docs/backup-design.md). `backupRun` never throws.
 */
export async function scheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const run = controller.cron === BACKUP_CRON ? backupRun(env) : cronRun(env);
  ctx.waitUntil(run);
  await run;
}
