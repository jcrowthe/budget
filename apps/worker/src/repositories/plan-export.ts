import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { payeeRenameRules } from "../db/schema/payee-rename-rules";
import { payees } from "../db/schema/payees";

/**
 * The live renaming rules of the plan's ordinary payees (hidden ones included), oldest first: payee name, kind
 * and text. One set query; a transfer payee's rules are not here (the import does not apply them either).
 */
export function listRulesForExport(
  db: Db,
  budgetId: string,
): Promise<{ payee: string; kind: string; text: string }[]> {
  return db
    .select({ payee: payees.name, kind: payeeRenameRules.kind, text: payeeRenameRules.text })
    .from(payeeRenameRules)
    .innerJoin(
      payees,
      and(eq(payees.id, payeeRenameRules.payeeId), isNull(payees.deletedAt), isNull(payees.system)),
    )
    .where(and(eq(payeeRenameRules.budgetId, budgetId), isNull(payeeRenameRules.deletedAt)))
    .orderBy(asc(payeeRenameRules.createdAt), asc(payeeRenameRules.id));
}
