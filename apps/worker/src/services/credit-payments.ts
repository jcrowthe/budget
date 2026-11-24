import { CREDIT_ACCOUNT_TYPES } from "@budget/core/account-types";
import { type SQL, sql } from "drizzle-orm";
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
import type { Db } from "../db/client";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { changeLog } from "../db/schema/change-log";
import { currentChangeSetId } from "../history/change-set";
import { paymentCategoryJson } from "../repositories/categories";
import { type LogBase, logSelectStmt } from "../repositories/guards";
import { insertSelect } from "../repositories/insert-select";

// EXF-532. Each credit account has one payment category in the plan's "Credit Card Payments" group. The
// builders return UNEXECUTED statements (each with its change_log row) for the account's own batch.

export const PAYMENT_GROUP_NAME = "Credit Card Payments";

type BatchItem = DrizzleBatchItem<"sqlite">;

export type PaymentLockCode =
  | "payment_group_locked"
  | "payment_category_locked"
  | "payment_category_target";

export const PAYMENT_LOCK_TEXT: Record<PaymentLockCode, string> = {
  payment_group_locked:
    "The Credit Card Payments group belongs to your credit accounts: it can't be renamed, hidden or deleted, and categories can't be added to it.",
  payment_category_locked:
    "A credit card payment category belongs to its account: it can't be renamed, hidden or deleted. Rename, close or delete the account instead.",
  payment_category_target: "Credit card payment categories can't have a target yet.",
};

export const PAYMENT_HISTORY_TEXT =
  "This card's payment category has assigned money or transactions. Set its assigned amounts to zero and move its transactions to another category first, or close the account instead.";

/** A rule of the Credit Card Payments group or its categories failed; the routes answer 422 with `code`. */
export class PaymentLocked extends Error {
  constructor(readonly code: PaymentLockCode) {
    super(PAYMENT_LOCK_TEXT[code]);
    this.name = "PaymentLocked";
  }
}

export const isPaymentGroup = (g: { kind: string | null }): boolean => g.kind !== null;
export const isPaymentCategory = (c: { kind: string | null }): boolean => c.kind !== null;

const isCreditType = (type: string): boolean =>
  (CREDIT_ACCOUNT_TYPES as readonly string[]).includes(type);

const livePaymentGroupOf = (budgetId: string): SQL =>
  sql`(select id from category_groups where budget_id = ${budgetId} and kind is not null and deleted_at is null)`;

export function paymentCreateStmts(
  db: Db,
  p: {
    actor: string;
    budgetId: string;
    accountId: string;
    name: string;
    type: string;
    now: string;
    accountExists: SQL;
  },
): BatchItem[] {
  if (!isCreditType(p.type)) return [];
  const out: BatchItem[] = [];
  const noCategory = sql`not exists (select 1 from categories where account_id = ${p.accountId} and deleted_at is null)`;
  const gid = crypto.randomUUID();
  const groupGuard = sql`${p.accountExists} and not exists (select 1 from category_groups where budget_id = ${p.budgetId} and kind is not null and deleted_at is null)`;
  out.push(
    insertSelect(
      db,
      categoryGroups,
      {
        id: gid,
        budgetId: p.budgetId,
        name: PAYMENT_GROUP_NAME,
        sortOrder: sql`coalesce((select min(sort_order) from category_groups where budget_id = ${p.budgetId} and deleted_at is null), 1) - 1`,
        hidden: sql`0`,
        collapsed: sql`0`,
        createdAt: p.now,
        updatedAt: p.now,
        deletedAt: sql`null`,
        kind: sql`'credit_card_payments'`,
      },
      sql`where ${groupGuard}`,
    ),
    insertSelect(
      db,
      changeLog,
      {
        id: crypto.randomUUID(),
        budgetId: p.budgetId,
        actor: p.actor,
        action: sql`'create'`,
        entityType: sql`'category_group'`,
        entityId: sql`g.id`,
        beforeJson: sql`null`,
        afterJson: sql`json_object('id', g.id, 'budget_id', g.budget_id, 'name', g.name, 'sort', g.sort_order, 'hidden', json('false'), 'collapsed', json('false'), 'kind', g.kind)`,
        createdAt: p.now,
        changeSetId: currentChangeSetId(),
      },
      sql`from category_groups g where g.id = ${gid}`,
    ),
  );
  const cid = crypto.randomUUID();
  const guard = sql`${p.accountExists} and ${noCategory} and ${livePaymentGroupOf(p.budgetId)} is not null`;
  out.push(
    insertSelect(
      db,
      categories,
      {
        id: cid,
        budgetId: p.budgetId,
        groupId: livePaymentGroupOf(p.budgetId),
        name: p.name,
        sortOrder: sql`(select coalesce(max(c.sort_order), -1) + 1 from categories c where c.group_id = ${livePaymentGroupOf(p.budgetId)} and c.deleted_at is null)`,
        hidden: sql`0`,
        createdAt: p.now,
        updatedAt: p.now,
        deletedAt: sql`null`,
        note: sql`null`,
        kind: sql`'credit_card_payment'`,
        accountId: p.accountId,
      },
      sql`where ${guard}`,
    ),
    logSelectStmt(
      db,
      {
        budgetId: p.budgetId,
        actor: p.actor,
        action: "create",
        entityType: "category",
        createdAt: p.now,
      },
      sql`select * from categories where id = ${cid}`,
      { entityId: sql`id`, before: null, after: paymentCategoryJson() },
    ),
  );
  return out;
}

export function paymentRenameStmts(
  db: Db,
  p: { actor: string; budgetId: string; accountId: string; name: string; now: string; guard: SQL },
): BatchItem[] {
  const live = sql`account_id = ${p.accountId} and kind is not null and deleted_at is null`;
  const base: LogBase = {
    budgetId: p.budgetId,
    actor: p.actor,
    action: "update",
    entityType: "category",
    createdAt: p.now,
  };
  return [
    logSelectStmt(
      db,
      base,
      sql`select * from categories where ${live} and ${p.guard} and name <> ${p.name}`,
      {
        entityId: sql`id`,
        before: paymentCategoryJson(),
        after: sql`json_set(${paymentCategoryJson()}, '$.name', ${p.name})`,
      },
    ),
    db
      .update(categories)
      .set({ name: p.name, updatedAt: p.now })
      .where(sql`${live} and ${p.guard}`),
  ];
}

export function paymentDeleteStmts(
  db: Db,
  p: { actor: string; budgetId: string; accountId: string; now: string; guard: SQL },
): BatchItem[] {
  const live = sql`account_id = ${p.accountId} and kind is not null and deleted_at is null`;
  const noHist = sql`not exists (select 1 from transactions t where t.budget_id = ${p.budgetId} and t.deleted_at is null and t.category_id = categories.id) and not exists (select 1 from month_categories m where m.budget_id = ${p.budgetId} and m.assigned <> 0 and m.category_id = categories.id)`;
  return [
    logSelectStmt(
      db,
      {
        budgetId: p.budgetId,
        actor: p.actor,
        action: "delete",
        entityType: "category",
        createdAt: p.now,
      },
      sql`select * from categories where ${live} and ${p.guard} and ${noHist}`,
      { entityId: sql`id`, before: paymentCategoryJson(), after: null },
    ),
    db
      .update(categories)
      .set({ deletedAt: p.now, updatedAt: p.now })
      .where(sql`${live} and ${p.guard} and ${noHist}`),
  ];
}
