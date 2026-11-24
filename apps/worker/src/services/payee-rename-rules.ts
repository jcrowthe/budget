import { PAYEE_ERRORS } from "@budget/schema/payees";
import {
  checkRuleText,
  foldRuleText,
  type PayeeRenameRule,
  RENAME_RULE_ERRORS,
  type RenameRuleKind,
} from "@budget/schema/rename-rules";
import { TRANSFER_PAYEE_PREFIX } from "@budget/schema/transfers";
import { and, eq, isNull, type SQLWrapper, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { accounts } from "../db/schema/accounts";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import { type LogBase, whenQuery } from "../repositories/guards";
import * as rulesRepo from "../repositories/payee-rename-rules";
import { PayeeRefused, pathPayee, requirePlan } from "./payees";

/**
 * The payee a rule's path names: an ordinary payee, or a transfer payee (`transfer:<account id>`) of a live account of
 * the plan. A rule on a transfer payee is stored and edited but the import never applies it: `rulesForPlanQuery` joins
 * the payees table, which has no row for a transfer payee (docs/rename-rules-design.md "Found, not built" 1).
 */
async function rulePayee(db: ReturnType<typeof getDb>, budgetId: string, payeeId: string) {
  if (!payeeId.startsWith(TRANSFER_PAYEE_PREFIX)) return pathPayee(db, budgetId, payeeId, false);
  const accountId = payeeId.slice(TRANSFER_PAYEE_PREFIX.length);
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.id, accountId), eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)),
    )
    .limit(1);
  if (!row) throw new NotFound("Payee");
}

/** A condition: the rule's payee exists, as `rulePayee` reads it. */
const payeeLiveSql = (budgetId: string, payeeId: string) =>
  payeeId.startsWith(TRANSFER_PAYEE_PREFIX)
    ? sql`exists (select 1 from accounts where id = ${payeeId.slice(TRANSFER_PAYEE_PREFIX.length)} and budget_id = ${budgetId} and deleted_at is null)`
    : rulesRepo.liveOrdinaryPayeeSql(budgetId, payeeId);

export function ruleToApi(r: rulesRepo.RuleRow): PayeeRenameRule {
  return {
    id: r.id,
    payee_id: r.payeeId,
    kind: r.kind,
    text: r.text,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

const unprocessable = (m: string) => new PayeeRefused(422, "unprocessable_entity", m);
const duplicate = () => new PayeeRefused(409, "conflict", RENAME_RULE_ERRORS.duplicate);

function textOf(input: string): string {
  const c = checkRuleText(input);
  if (!c.ok) throw unprocessable(RENAME_RULE_ERRORS[c.error]);
  return c.text;
}

async function ruleOf(
  db: ReturnType<typeof getDb>,
  budgetId: string,
  payeeId: string,
  ruleId: string,
) {
  const rule = await rulesRepo.findLive(db, budgetId, payeeId, ruleId);
  if (!rule) throw new NotFound("Rename rule");
  return rule;
}

export async function listRenameRules(
  env: Env,
  budgetId: string,
  payeeId: string,
): Promise<PayeeRenameRule[]> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  await rulePayee(db, budgetId, payeeId);
  return (await rulesRepo.listForPayee(db, budgetId, payeeId)).map(ruleToApi);
}

export async function createRenameRule(
  env: Env,
  actor: string,
  budgetId: string,
  payeeId: string,
  input: { kind: RenameRuleKind; text: string },
): Promise<PayeeRenameRule> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  await rulePayee(db, budgetId, payeeId);
  const text = textOf(input.text);
  const now = new Date().toISOString();
  const row: rulesRepo.RuleRow = {
    id: crypto.randomUUID(),
    budgetId,
    payeeId,
    kind: input.kind,
    text,
    matchText: foldRuleText(text),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const guard = payeeLiveSql(budgetId, payeeId);
  try {
    const res = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "create",
          entityType: "payee_rename_rule",
          entityId: row.id,
          before: null,
          after: rulesRepo.ruleLog(row),
        },
        whenQuery(db, guard),
      ),
      rulesRepo.insertStmt(db, row, guard),
    ]);
    if (((res[1] as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0)
      throw new NotFound("Payee");
  } catch (e) {
    if (rulesRepo.isUniqueViolation(e)) throw duplicate();
    throw e;
  }
  return ruleToApi(row);
}

export async function updateRenameRule(
  env: Env,
  actor: string,
  budgetId: string,
  payeeId: string,
  ruleId: string,
  input: { kind?: RenameRuleKind; text?: string },
): Promise<PayeeRenameRule> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  await rulePayee(db, budgetId, payeeId);
  const before = await ruleOf(db, budgetId, payeeId, ruleId);
  if (input.kind === undefined && input.text === undefined)
    throw unprocessable(RENAME_RULE_ERRORS.noField);
  const text = input.text === undefined ? before.text : textOf(input.text);
  const kind = input.kind ?? before.kind;
  const matchText = foldRuleText(text);
  if (kind === before.kind && matchText === before.matchText && text === before.text)
    return ruleToApi(before);
  const now = new Date().toISOString();
  const after = { ...before, kind, text, matchText, updatedAt: now };
  const same = rulesRepo.ruleUnchangedSql(before);
  try {
    const res = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "payee_rename_rule",
          entityId: ruleId,
          before: rulesRepo.ruleLog(before),
          after: rulesRepo.ruleLog(after),
        },
        whenQuery(db, same),
      ),
      rulesRepo.updateStmt(db, ruleId, { kind, text, matchText }, now, before),
    ]);
    if (((res[1] as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0)
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.race);
  } catch (e) {
    if (rulesRepo.isUniqueViolation(e)) throw duplicate();
    throw e;
  }
  return ruleToApi(after);
}

export async function deleteRenameRule(
  env: Env,
  actor: string,
  budgetId: string,
  payeeId: string,
  ruleId: string,
): Promise<PayeeRenameRule> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  await rulePayee(db, budgetId, payeeId);
  const before = await ruleOf(db, budgetId, payeeId, ruleId);
  const now = new Date().toISOString();
  const res = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "delete",
        entityType: "payee_rename_rule",
        entityId: ruleId,
        before: rulesRepo.ruleLog(before),
        after: null,
      },
      whenQuery(db, rulesRepo.ruleUnchangedSql(before)),
    ),
    rulesRepo.softDeleteStmt(db, ruleId, now, before),
  ]);
  if (((res[1] as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0)
    throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.race);
  return ruleToApi(before);
}

export type AutoRule = {
  budgetId: string;
  actor: string;
  now: string;
  /** The payee the row now has. */
  payeeId: string;
  /** The row's `import_payee_name`. */
  importName: string;
  /** `learn`: the owner moved the row to another payee; `undo`: to the payee named as imported. */
  mode: "learn" | "undo";
};

/** The rule `is <imported name>` on the payee, as a row (no write). */
function autoRow(a: AutoRule, text: string): rulesRepo.RuleRow {
  return {
    id: crypto.randomUUID(),
    budgetId: a.budgetId,
    payeeId: a.payeeId,
    kind: "is",
    text,
    matchText: foldRuleText(text),
    createdAt: a.now,
    updatedAt: a.now,
    deletedAt: null,
  };
}

/**
 * The statements of the rules a row's payee change makes by itself, in the change's own batch, each under `guard`
 * (the batch's condition) and with its history row by the change's actor: no read, no round trip.
 * Learn: every other payee's `is <name>` goes, and `is <name>` on the new payee unless it has it. Undo: every other payee's `is <name>` goes, and if a
 * `contains` rule of another payee still matches the name, the new payee gets `is <name>` so that it holds.
 * Empty when the imported name cannot be a rule's text (blank, over 200 characters).
 */
export function autoRuleStmts(db: ReturnType<typeof getDb>, a: AutoRule, guard: SQLWrapper) {
  const checked = checkRuleText(a.importName);
  if (!checked.ok) return [];
  const cond = sql`exists ${guard}`;
  const base: LogBase = {
    budgetId: a.budgetId,
    actor: a.actor,
    action: "create",
    entityType: "payee_rename_rule",
    createdAt: a.now,
  };
  const row = autoRow(a, checked.text);
  if (a.mode === "learn")
    return [
      // Every other payee's `is <name>` goes, so the correction is the only one left (created_at is never rewritten).
      ...rulesRepo.removeIsRulesStmts(db, base, a.budgetId, row.matchText, a.payeeId, cond),
      ...rulesRepo.addIfMissingStmts(db, base, row, cond),
    ];
  return [
    ...rulesRepo.removeIsRulesStmts(db, base, a.budgetId, row.matchText, a.payeeId, cond),
    ...rulesRepo.addIfMissingStmts(
      db,
      base,
      row,
      sql`${cond} and ${rulesRepo.containsMatchSql(a.budgetId, row.matchText, a.payeeId)}`,
    ),
  ];
}
