import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { userSettings } from "../db/schema/user-settings";

export interface SettingsRow {
  theme: string;
  progressBars: boolean;
  balanceStyle: string;
}

/** The actor's row, one select by primary key; undefined when nothing was saved yet. */
export async function findByActor(db: Db, actor: string): Promise<SettingsRow | undefined> {
  const [row] = await db
    .select({
      theme: userSettings.theme,
      progressBars: userSettings.progressBars,
      balanceStyle: userSettings.balanceStyle,
    })
    .from(userSettings)
    .where(eq(userSettings.actor, actor))
    .limit(1);
  return row;
}

/** UNEXECUTED statement: inserts or replaces the actor's full row. */
export function upsertStmt(db: Db, actor: string, values: SettingsRow, now: string) {
  return db
    .insert(userSettings)
    .values({
      actor,
      theme: values.theme,
      progressBars: values.progressBars,
      balanceStyle: values.balanceStyle,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSettings.actor,
      set: {
        theme: values.theme,
        progressBars: values.progressBars,
        balanceStyle: values.balanceStyle,
        updatedAt: now,
      },
    });
}
