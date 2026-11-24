import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { payeeRenameRules } from "../db/schema/payee-rename-rules";
import { payees } from "../db/schema/payees";
import { changeLogInsertIf } from "../history/change-log";
import { type LogBase, logSelectStmt, whenQuery } from "./guards";
import { insertSelect } from "./insert-select";
import { idsIn } from "./payees";

export type RuleRow = typeof payeeRenameRules.$inferSelect;

const live = (budgetId: string) =>
  and(eq(payeeRenameRules.budgetId, budgetId), isNull(payeeRenameRules.deletedAt));

/** Live rules of one payee, oldest first. */
export function listForPayee(db: Db, budgetId: string, payeeId: string): Promise<RuleRow[]> {
  return db
    .select()
    .from(payeeRenameRules)
    .where(and(live(budgetId), eq(payeeRenameRules.payeeId, payeeId)))
    .orderBy(asc(payeeRenameRules.createdAt), asc(payeeRenameRules.id));
}

/** Unexecuted: the transfer payee ids (`transfer:<account id>`) of the plan that have a live rule. */
export const transferIdsWithRulesQuery = (db: Db, budgetId: string) =>
  db
    .selectDistinct({ id: payeeRenameRules.payeeId })
    .from(payeeRenameRules)
    .where(and(live(budgetId), sql`${payeeRenameRules.payeeId} like 'transfer:%'`));

export async function findLive(
  db: Db,
  budgetId: string,
  payeeId: string,
  ruleId: string,
): Promise<RuleRow | undefined> {
  const [r] = await db
    .select()
    .from(payeeRenameRules)
    .where(
      and(live(budgetId), eq(payeeRenameRules.payeeId, payeeId), eq(payeeRenameRules.id, ruleId)),
    )
    .limit(1);
  return r;
}

/** Unexecuted: the live rules of the plan's live ordinary payees (hidden ones included). */
export function rulesForPlanQuery(db: Db, budgetId: string) {
  return db
    .select({ r: payeeRenameRules })
    .from(payeeRenameRules)
    .innerJoin(
      payees,
      and(eq(payees.id, payeeRenameRules.payeeId), isNull(payees.deletedAt), isNull(payees.system)),
    )
    .where(live(budgetId));
}

/** A condition: the rule's payee is live, ordinary and in the plan. */
export const liveOrdinaryPayeeSql = (budgetId: string, payeeId: string | SQL) =>
  sql`exists (select 1 from payees where id = ${payeeId} and budget_id = ${budgetId} and deleted_at is null and system is null)`;

export const ruleLog = (r: Pick<RuleRow, "id" | "payeeId" | "kind" | "text">) => ({
  id: r.id,
  payee_id: r.payeeId,
  kind: r.kind,
  text: r.text,
});

/** A condition: the payee already has a live rule of this kind and folded text. */
export function hasRuleSql(payeeId: string | SQL, kind: "is" | "contains", matchText: string): SQL {
  return sql`exists (select 1 from payee_rename_rules where payee_id = ${payeeId} and kind = ${kind} and match_text = ${matchText} and deleted_at is null)`;
}

/**
 * A condition: a live `contains` rule of another live ordinary payee of the plan matches the folded name.
 * The same definition as `pickRenameRule`: the stored folded text is a part of the folded name.
 */
export function containsMatchSql(
  budgetId: string,
  folded: string,
  exceptPayeeId: string | SQL,
): SQL {
  return sql`exists (select 1 from payee_rename_rules r join payees p on p.id = r.payee_id and p.deleted_at is null and p.system is null
    where r.budget_id = ${budgetId} and r.kind = 'contains' and r.deleted_at is null and r.payee_id <> ${exceptPayeeId}
    and instr(${folded}, r.match_text) > 0)`;
}

/** Inserts the rule only while `guard` (a condition) holds. */
export function insertStmt(db: Db, row: RuleRow, guard: SQL) {
  return insertSelect(
    db,
    payeeRenameRules,
    {
      id: row.id,
      budgetId: row.budgetId,
      payeeId: row.payeeId,
      kind: row.kind,
      text: row.text,
      matchText: row.matchText,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    },
    sql`where ${guard}`,
  );
}

/** A condition: the rule still reads as `before` and is live. */
export const ruleUnchangedSql = (before: RuleRow) =>
  sql`exists (select 1 from payee_rename_rules where id = ${before.id} and deleted_at is null and kind = ${before.kind} and match_text = ${before.matchText} and text = ${before.text})`;

export function updateStmt(
  db: Db,
  ruleId: string,
  set: { kind?: "is" | "contains"; text?: string; matchText?: string },
  now: string,
  before: RuleRow,
) {
  return db
    .update(payeeRenameRules)
    .set({ ...set, updatedAt: now })
    .where(and(eq(payeeRenameRules.id, ruleId), ruleUnchangedSql(before)));
}

export function softDeleteStmt(db: Db, ruleId: string, now: string, before: RuleRow) {
  return db
    .update(payeeRenameRules)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(payeeRenameRules.id, ruleId), ruleUnchangedSql(before)));
}

/** The log row and the rule, made unless the payee has it, while `cond` holds. */
export function addIfMissingStmts(db: Db, base: LogBase, row: RuleRow, cond: SQL) {
  const where = sql`${cond} and not ${hasRuleSql(row.payeeId, row.kind, row.matchText)}`;
  return [
    changeLogInsertIf(
      db,
      {
        budgetId: base.budgetId,
        actor: base.actor,
        action: "create",
        entityType: "payee_rename_rule",
        entityId: row.id,
        before: null,
        after: ruleLog(row),
      },
      whenQuery(db, where),
    ),
    insertStmt(db, row, where),
  ] as const;
}

const ruleJson = sql`json_object('id', id, 'payee_id', payee_id, 'kind', kind, 'text', text)`;

/** History rows, then the soft delete, of the live rules chosen by `where` (a condition over the rule's columns). */
function removeWhere(db: Db, base: LogBase, where: SQL, now: string) {
  return [
    logSelectStmt(
      db,
      { ...base, action: "delete", entityType: "payee_rename_rule" },
      sql`select id, payee_id, kind, text from payee_rename_rules where deleted_at is null and ${where}`,
      { entityId: sql`id`, before: ruleJson, after: null },
    ),
    db
      .update(payeeRenameRules)
      .set({ deletedAt: now, updatedAt: now })
      .where(sql`deleted_at is null and ${where}`),
  ] as const;
}

/** Removes every live `is` rule with that folded text in the plan whose payee is not `keepPayeeId`. */
export function removeIsRulesStmts(
  db: Db,
  base: LogBase,
  budgetId: string,
  matchText: string,
  keepPayeeId: string | SQL,
  cond: SQL,
) {
  return removeWhere(
    db,
    base,
    sql`budget_id = ${budgetId} and kind = 'is' and match_text = ${matchText} and payee_id <> ${keepPayeeId} and ${cond}`,
    base.createdAt,
  );
}

/** Removes every live rule of the payees. */
export function removeForPayeesStmts(
  db: Db,
  base: LogBase,
  budgetId: string,
  payeeIds: readonly string[],
  cond: SQL,
) {
  return removeWhere(
    db,
    base,
    sql`budget_id = ${budgetId} and ${idsIn(sql`payee_id`, payeeIds)} and ${cond}`,
    base.createdAt,
  );
}

export function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e; x instanceof Error; x = x.cause) {
    if (x.message.includes("UNIQUE constraint failed: payee_rename_rules")) return true;
  }
  return false;
}
