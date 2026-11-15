import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { months } from "../db/schema/months";

export type MonthRow = typeof months.$inferSelect;

export async function listNotes(db: Db, budgetId: string): Promise<MonthRow[]> {
  return db.select().from(months).where(eq(months.budgetId, budgetId));
}

export async function find(db: Db, budgetId: string, month: string): Promise<MonthRow | undefined> {
  const [row] = await db
    .select()
    .from(months)
    .where(and(eq(months.budgetId, budgetId), eq(months.month, month)))
    .limit(1);
  return row;
}

export function upsertNoteStmt(db: Db, v: MonthRow) {
  return db
    .insert(months)
    .values(v)
    .onConflictDoUpdate({
      target: [months.budgetId, months.month],
      set: { note: v.note, updatedAt: v.updatedAt },
    });
}
