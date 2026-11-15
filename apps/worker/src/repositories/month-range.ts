import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { monthCategories as mc } from "../db/schema/month-categories";
import { months } from "../db/schema/months";
import { transactions as tx } from "../db/schema/transactions";

export interface MonthFacts {
  firstAssigned: string | null;
  lastAssigned: string | null;
  firstNote: string | null;
  firstTransaction: string | null;
}

/** Read only: the earliest and latest months that hold data of a plan, in one statement. */
export async function monthFacts(db: Db, budgetId: string): Promise<MonthFacts> {
  const row = await db.get<{
    firstAssigned: string | null;
    lastAssigned: string | null;
    firstNote: string | null;
    firstTransaction: string | null;
  }>(sql`select
    (select min(${mc.month}) from ${mc} where ${mc.budgetId} = ${budgetId} and ${mc.assigned} <> 0) as firstAssigned,
    (select max(${mc.month}) from ${mc} where ${mc.budgetId} = ${budgetId} and ${mc.assigned} <> 0) as lastAssigned,
    (select min(${months.month}) from ${months} where ${months.budgetId} = ${budgetId} and ${months.note} is not null) as firstNote,
    (select case when count(*) = 0 then null else min(substr(${tx.date}, 1, 7)) || '-01' end
       from ${tx} where ${tx.budgetId} = ${budgetId} and ${tx.deletedAt} is null) as firstTransaction`);
  return {
    firstAssigned: row?.firstAssigned ?? null,
    lastAssigned: row?.lastAssigned ?? null,
    firstNote: row?.firstNote ?? null,
    firstTransaction: row?.firstTransaction ?? null,
  };
}
