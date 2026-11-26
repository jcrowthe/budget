import { DEFAULT_SETTINGS, type Settings, SettingsPatch } from "@budget/schema/settings";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import * as repo from "../repositories/settings";

const toSettings = (row: repo.SettingsRow | undefined): Settings =>
  row
    ? {
        theme: row.theme as Settings["theme"],
        progress_bars: row.progressBars,
        balance_style: row.balanceStyle as Settings["balance_style"],
      }
    : { ...DEFAULT_SETTINGS };

/** The actor's settings, or the defaults when none were saved. One D1 call. */
export async function getSettings(env: Env, actor: string): Promise<Settings> {
  return toSettings(await repo.findByActor(getDb(env), actor));
}

/**
 * Merges a partial update. One read, then one batch (row + change_log). An empty patch writes nothing.
 * The input is parsed here too, so a caller other than the route cannot store a bad value.
 */
export async function updateSettings(
  env: Env,
  actor: string,
  input: SettingsPatch,
): Promise<Settings> {
  const patch = SettingsPatch.parse(input);
  const db = getDb(env);
  const row = await repo.findByActor(db, actor);
  const before = toSettings(row);
  const after: Settings = { ...before };
  for (const k of Object.keys(patch) as (keyof Settings)[]) {
    if (patch[k] !== undefined) (after as Record<string, unknown>)[k] = patch[k];
  }
  if (Object.keys(patch).every((k) => patch[k as keyof SettingsPatch] === undefined)) return before;
  await db.batch([
    repo.upsertStmt(
      db,
      actor,
      {
        theme: after.theme,
        progressBars: after.progress_bars,
        balanceStyle: after.balance_style,
      },
      new Date().toISOString(),
    ),
    changeLogInsert(db, {
      budgetId: null,
      actor,
      action: row ? "update" : "create",
      entityType: "user_settings",
      entityId: actor,
      before: row ? before : null,
      after,
    }),
  ]);
  return after;
}
