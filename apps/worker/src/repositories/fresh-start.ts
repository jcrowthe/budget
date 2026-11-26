import { and, eq, getTableColumns, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { bankAccounts } from "../db/schema/bank-accounts";
import { budgets } from "../db/schema/budgets";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { changeLog } from "../db/schema/change-log";
import { months } from "../db/schema/months";
import { payeeRenameRules } from "../db/schema/payee-rename-rules";
import { payees } from "../db/schema/payees";
import { planViews } from "../db/schema/plan-views";
import { scheduledSubtransactions } from "../db/schema/scheduled-subtransactions";
import { scheduledTransactions } from "../db/schema/scheduled-transactions";
import { targetSnoozes } from "../db/schema/target-snoozes";
import { targets } from "../db/schema/targets";
import { transactions } from "../db/schema/transactions";
import { type ChangeLogEntry, changeLogInsert } from "../history/change-log";
import { currentChangeSetId } from "../history/change-set";
import * as budgetsRepo from "./budgets";
import { logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";

/**
 * Fresh Start (EXF-478): the plan's structure copied into a new plan with set-based insert-selects, whatever its
 * size. The id maps travel as ONE bound JSON parameter each (`{old: new}`, accounts an array of
 * `{old, new, amount, rta, bank}`), joined with `json_each`, so no statement holds more than a few parameters.
 */

/** The read batch: ONE `db.batch` (one call, one snapshot). Order matters to `FreshStartRead`. */
export function readSourceStmts(db: Db, budgetId: string) {
  return [
    db
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, budgetId), isNull(budgets.deletedAt))),
    db
      .select({ id: budgets.id, name: budgets.name })
      .from(budgets)
      .where(isNull(budgets.deletedAt))
      .orderBy(budgets.id),
    db
      .select({
        ...getTableColumns(accounts),
        bankRowId: sql<string | null>`${bankAccounts.id}`.as("bank_row_id"),
        bankType: sql<string | null>`${bankAccounts.type}`.as("bank_type"),
        bankBalance: sql<number | null>`${bankAccounts.currentBalance}`.as("bank_balance"),
      })
      .from(accounts)
      .leftJoin(bankAccounts, eq(bankAccounts.id, accounts.bankAccountId))
      .where(and(eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)))
      .orderBy(accounts.id),
    db
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(and(eq(categoryGroups.budgetId, budgetId), isNull(categoryGroups.deletedAt))),
    db
      .select({ id: categories.id })
      .from(categories)
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(
        and(
          eq(categories.budgetId, budgetId),
          isNull(categories.deletedAt),
          isNull(categoryGroups.deletedAt),
        ),
      ),
    db
      .select({ id: payees.id })
      .from(payees)
      .where(and(eq(payees.budgetId, budgetId), isNull(payees.deletedAt))),
    db
      .select({ id: scheduledTransactions.id })
      .from(scheduledTransactions)
      .innerJoin(accounts, eq(accounts.id, scheduledTransactions.accountId))
      .where(
        and(
          eq(scheduledTransactions.budgetId, budgetId),
          isNull(scheduledTransactions.deletedAt),
          isNull(accounts.deletedAt),
        ),
      ),
    db
      .select({ id: scheduledSubtransactions.id })
      .from(scheduledSubtransactions)
      .innerJoin(
        scheduledTransactions,
        eq(scheduledTransactions.id, scheduledSubtransactions.scheduledTransactionId),
      )
      .innerJoin(accounts, eq(accounts.id, scheduledTransactions.accountId))
      .where(
        and(
          eq(scheduledSubtransactions.budgetId, budgetId),
          isNull(scheduledSubtransactions.deletedAt),
          isNull(scheduledTransactions.deletedAt),
          isNull(accounts.deletedAt),
        ),
      ),
  ] as const;
}

export interface AccountMapEntry {
  old: string;
  new: string;
  amount: number;
  rta: 0 | 1;
  bank: string | null;
}

export interface CopyInput {
  oldId: string;
  newId: string;
  now: string;
  today: string;
  /** First day of today's month. */
  month: string;
  archiveName: string;
  newBudget: budgetsRepo.NewBudgetRow;
  /** The source row as read: the archive's rename holds only while it is unchanged. */
  source: Pick<budgetsRepo.BudgetRow, "id" | "updatedAt">;
  /** `json_group_array(id || ':' || name)` of the active plans (by id), as read. */
  activeBudgets: string;
  accounts: AccountMapEntry[];
  groups: Record<string, string>;
  categories: Record<string, string>;
  payees: Record<string, string>;
  schedules: Record<string, string>;
  subtransactionCount: number;
  /** `json_group_array(id || ':' || bank_account_id || ':' || link_missing_since)` of linked accounts, as read. */
  linkedAsRead: string;
  stopImporting: boolean;
  actor: string;
  /** The id given to the new plan's Starting Balance payee when it has to be created. */
  startingPayeeId: string;
  logs: ChangeLogEntry[];
}

/** A version-4 uuid made in SQL, new for every row (the API's schemas parse ids with `z.uuid()`). */
const uuidSql = sql`lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`;

const json = (v: unknown) => JSON.stringify(v);

/** Live rows of a table the copy covers: the same set the read batch listed. */
function covers(what: { from: SQL; id: SQL; keys: string; n: number; keyOf?: SQL }): SQL {
  const key = what.keyOf ?? sql`m.key`;
  return sql`(select count(*) ${what.from}) != ${what.n}
    or exists (select 1 ${what.from} and not exists (select 1 from json_each(${what.keys}) m where ${key} = ${what.id}))`;
}

/**
 * The first statement of the write batch: it fails the whole batch (NOT NULL on `change_log.actor`) when anything
 * the read saw has changed since, so a Fresh Start that raced a write commits nothing. `isFreshStartRaced`
 * recognises it.
 */
function abortGuard(db: Db, i: CopyInput): ReturnType<typeof insertSelect> {
  const ob = i.oldId;
  const accountKeys = json(Object.fromEntries(i.accounts.map((a) => [a.old, a.new])));
  const live = {
    groups: sql`from category_groups x where x.budget_id = ${ob} and x.deleted_at is null`,
    categories: sql`from categories x join category_groups g on g.id = x.group_id where x.budget_id = ${ob} and x.deleted_at is null and g.deleted_at is null`,
    payees: sql`from payees x where x.budget_id = ${ob} and x.deleted_at is null`,
    accounts: sql`from accounts x where x.budget_id = ${ob} and x.deleted_at is null`,
    schedules: sql`from scheduled_transactions x join accounts a on a.id = x.account_id where x.budget_id = ${ob} and x.deleted_at is null and a.deleted_at is null`,
    subs: sql`from scheduled_subtransactions x join scheduled_transactions s on s.id = x.scheduled_transaction_id join accounts a on a.id = s.account_id where x.budget_id = ${ob} and x.deleted_at is null and s.deleted_at is null and a.deleted_at is null`,
  };
  const conds: SQL[] = [
    sql`not exists (select 1 from budgets where id = ${ob} and deleted_at is null and updated_at = ${i.source.updatedAt})`,
    sql`(select coalesce(json_group_array(id || ':' || name), '[]') from (select id, name from budgets where deleted_at is null order by id)) != ${i.activeBudgets}`,
    covers({ from: live.accounts, id: sql`x.id`, keys: accountKeys, n: i.accounts.length }),
    covers({
      from: live.groups,
      id: sql`x.id`,
      keys: json(i.groups),
      n: Object.keys(i.groups).length,
    }),
    covers({
      from: live.categories,
      id: sql`x.id`,
      keys: json(i.categories),
      n: Object.keys(i.categories).length,
    }),
    covers({
      from: live.payees,
      id: sql`x.id`,
      keys: json(i.payees),
      n: Object.keys(i.payees).length,
    }),
    covers({
      from: live.schedules,
      id: sql`x.id`,
      keys: json(i.schedules),
      n: Object.keys(i.schedules).length,
    }),
    sql`(select count(*) ${live.subs}) != ${i.subtransactionCount}`,
    sql`(select coalesce(json_group_array(id || ':' || bank_account_id || ':' || coalesce(link_missing_since, '')), '[]') from (select id, bank_account_id, link_missing_since from accounts where budget_id = ${ob} and deleted_at is null and bank_account_id is not null order by id)) != ${i.linkedAsRead}`,
  ];
  return insertSelect(
    db,
    changeLog,
    {
      id: sql`'fresh-start-raced'`,
      budgetId: ob,
      actor: sql`null`,
      action: sql`'update'`,
      entityType: sql`'fresh_start'`,
      entityId: sql`'fresh-start-raced'`,
      createdAt: sql`''`,
      changeSetId: currentChangeSetId(),
    },
    sql`where ${sql.join(
      conds.map((c) => sql`(${c})`),
      sql` or `,
    )}`,
  );
}

/** True when `e` is the abort guard firing. */
export function isFreshStartRaced(e: unknown): boolean {
  for (let x: unknown = e; x instanceof Error; x = x.cause) {
    if (x.message.includes("NOT NULL constraint failed: change_log.actor")) return true;
  }
  return false;
}

/**
 * The write batch, in foreign-key order. A constant number of statements (about 25) whatever the plan's size.
 */
export function copyStmts(db: Db, i: CopyInput) {
  const ob = i.oldId;
  const nb = i.newId;
  const now = i.now;
  const accJson = json(i.accounts);
  const grpJson = json(i.groups);
  const catJson = json(i.categories);
  const payJson = json(i.payees);
  const schJson = json(i.schedules);
  const accNew = (alias: string) => sql.raw(`json_extract(${alias}.value, '$.new')`);
  const accOld = (alias: string) => sql.raw(`json_extract(${alias}.value, '$.old')`);
  const linkedWhere = sql`budget_id = ${ob} and deleted_at is null and bank_account_id is not null`;

  const out: unknown[] = [];
  // 1. abort guard
  out.push(abortGuard(db, i));
  // 2. the new plan, 3. the archive's rename
  out.push(budgetsRepo.insertStmt(db, i.newBudget));
  out.push(
    db
      .update(budgets)
      .set({ name: i.archiveName, updatedAt: now })
      .where(budgetsRepo.unchanged(i.source)),
  );
  // 4. accounts (paired_category_id remapped: no foreign key on it)
  out.push(
    insertSelect(
      db,
      accounts,
      {
        id: accNew("am"),
        budgetId: nb,
        name: sql`a.name`,
        type: sql`a.type`,
        onBudget: sql`a.on_budget`,
        note: sql`a.note`,
        starred: sql`a.starred`,
        closed: sql`a.closed`,
        sortOrder: sql`a.sort_order`,
        createdAt: now,
        bankAccountId: sql.raw("json_extract(am.value, '$.bank')"),
        importStartDate: sql`case when json_extract(am.value, '$.bank') is not null then ${i.today} end`,
        linkMissingSince: sql`case when json_extract(am.value, '$.bank') is not null then a.link_missing_since end`,
        interestRate: sql`a.interest_rate`,
        minimumPayment: sql`a.minimum_payment`,
        escrowAmount: sql`a.escrow_amount`,
        pairedCategoryId: sql`pc.value`,
      },
      sql`from accounts a join json_each(${accJson}) am on ${accOld("am")} = a.id
        left join json_each(${catJson}) pc on pc.key = a.paired_category_id
        where a.budget_id = ${ob} and a.deleted_at is null`,
    ),
  );
  // 5. category groups
  out.push(
    insertSelect(
      db,
      categoryGroups,
      {
        id: sql`gm.value`,
        budgetId: nb,
        name: sql`g.name`,
        sortOrder: sql`g.sort_order`,
        hidden: sql`g.hidden`,
        createdAt: now,
        updatedAt: now,
        kind: sql`g.kind`,
      },
      sql`from category_groups g join json_each(${grpJson}) gm on gm.key = g.id
        where g.budget_id = ${ob} and g.deleted_at is null`,
    ),
  );
  // 6. categories
  out.push(
    insertSelect(
      db,
      categories,
      {
        id: sql`cm.value`,
        budgetId: nb,
        groupId: sql`gm.value`,
        name: sql`c.name`,
        sortOrder: sql`c.sort_order`,
        hidden: sql`c.hidden`,
        createdAt: now,
        updatedAt: now,
        note: sql`c.note`,
        kind: sql`c.kind`,
        accountId: sql.raw("json_extract(pa.value, '$.new')"),
      },
      sql`from categories c
        join json_each(${grpJson}) gm on gm.key = c.group_id
        join json_each(${catJson}) cm on cm.key = c.id
        left join json_each(${accJson}) pa on ${accOld("pa")} = c.account_id
        where c.budget_id = ${ob} and c.deleted_at is null`,
    ),
  );
  // 7. targets
  out.push(
    insertSelect(
      db,
      targets,
      {
        categoryId: sql`cm.value`,
        budgetId: nb,
        cadence: sql`t.cadence`,
        behavior: sql`t.behavior`,
        amount: sql`t.amount`,
        dayOfWeek: sql`t.day_of_week`,
        dayOfMonth: sql`t.day_of_month`,
        dueDate: sql`t.due_date`,
        dueMonth: sql`t.due_month`,
        repeatEvery: sql`t.repeat_every`,
        repeatUnit: sql`t.repeat_unit`,
        createdOn: sql`t.created_on`,
        createdAt: now,
        updatedAt: now,
      },
      sql`from targets t join json_each(${catJson}) cm on cm.key = t.category_id where t.budget_id = ${ob}`,
    ),
  );
  // 8. target snoozes from this month on
  out.push(
    insertSelect(
      db,
      targetSnoozes,
      { budgetId: nb, categoryId: sql`cm.value`, month: sql`s.month`, createdAt: now },
      sql`from target_snoozes s join json_each(${catJson}) cm on cm.key = s.category_id
        where s.budget_id = ${ob} and s.month >= ${i.month}`,
    ),
  );
  // 9. month notes from this month on
  out.push(
    insertSelect(
      db,
      months,
      { budgetId: nb, month: sql`m.month`, note: sql`m.note`, updatedAt: now },
      sql`from months m where m.budget_id = ${ob} and m.month >= ${i.month} and m.note is not null`,
    ),
  );
  // 10. payees (fixed and default categories remapped, null when not copied)
  out.push(
    insertSelect(
      db,
      payees,
      {
        id: sql`pm.value`,
        budgetId: nb,
        name: sql`p.name`,
        hidden: sql`p.hidden`,
        system: sql`p.system`,
        createdAt: now,
        updatedAt: now,
        categoryMode: sql`p.category_mode`,
        fixedCategoryId: sql`fc.value`,
        fixedInflowToReadyToAssign: sql`p.fixed_inflow_to_ready_to_assign`,
        defaultCategoryId: sql`dc.value`,
        defaultInflowToReadyToAssign: sql`p.default_inflow_to_ready_to_assign`,
      },
      sql`from payees p join json_each(${payJson}) pm on pm.key = p.id
        left join json_each(${catJson}) fc on fc.key = p.fixed_category_id
        left join json_each(${catJson}) dc on dc.key = p.default_category_id
        where p.budget_id = ${ob} and p.deleted_at is null`,
    ),
  );
  // 11. the Starting Balance system payee, when the old plan had none
  out.push(
    insertSelect(
      db,
      payees,
      {
        id: i.startingPayeeId,
        budgetId: nb,
        name: "Starting Balance",
        hidden: 0,
        system: "starting_balance",
        createdAt: now,
        updatedAt: now,
      },
      sql`where not exists (select 1 from payees x where x.budget_id = ${nb} and x.system = 'starting_balance' and x.deleted_at is null)`,
    ),
  );
  // 12. rename rules of copied payees
  out.push(
    insertSelect(
      db,
      payeeRenameRules,
      {
        id: uuidSql,
        budgetId: nb,
        payeeId: sql`pm.value`,
        kind: sql`r.kind`,
        text: sql`r.text`,
        matchText: sql`r.match_text`,
        createdAt: now,
        updatedAt: now,
      },
      sql`from payee_rename_rules r join json_each(${payJson}) pm on pm.key = r.payee_id
        where r.budget_id = ${ob} and r.deleted_at is null`,
    ),
  );
  // 13. plan views (category_ids remapped, in order; ids not copied dropped)
  out.push(
    insertSelect(
      db,
      planViews,
      {
        id: uuidSql,
        budgetId: nb,
        builtinKey: sql`v.builtin_key`,
        name: sql`v.name`,
        categoryIds: sql`(select coalesce(json_group_array(n), '[]') from (select cm.value as n from json_each(v.category_ids) c join json_each(${catJson}) cm on cm.key = c.value order by c.key))`,
        sortOrder: sql`v.sort_order`,
        createdAt: now,
        updatedAt: now,
      },
      sql`from plan_views v where v.budget_id = ${ob} and v.deleted_at is null`,
    ),
  );
  // 14. scheduled transactions
  out.push(
    insertSelect(
      db,
      scheduledTransactions,
      {
        id: sql`sm.value`,
        budgetId: nb,
        accountId: accNew("am"),
        dateFirst: sql`s.date_first`,
        dateNext: sql`s.date_next`,
        frequency: sql`s.frequency`,
        amount: sql`s.amount`,
        payeeId: sql`pm.value`,
        categoryId: sql`cm.value`,
        inflowToReadyToAssign: sql`s.inflow_to_ready_to_assign`,
        memo: sql`s.memo`,
        flagColor: sql`s.flag_color`,
        transferAccountId: sql.raw("json_extract(tm.value, '$.new')"),
        writeToken: uuidSql,
        createdAt: now,
        updatedAt: now,
      },
      sql`from scheduled_transactions s
        join accounts a on a.id = s.account_id and a.deleted_at is null
        join json_each(${schJson}) sm on sm.key = s.id
        join json_each(${accJson}) am on ${accOld("am")} = s.account_id
        left join json_each(${accJson}) tm on ${accOld("tm")} = s.transfer_account_id
        left join json_each(${payJson}) pm on pm.key = s.payee_id
        left join json_each(${catJson}) cm on cm.key = s.category_id
        where s.budget_id = ${ob} and s.deleted_at is null`,
    ),
  );
  // 15. scheduled subtransactions
  out.push(
    insertSelect(
      db,
      scheduledSubtransactions,
      {
        id: uuidSql,
        budgetId: nb,
        scheduledTransactionId: sql`sm.value`,
        amount: sql`l.amount`,
        payeeId: sql`pm.value`,
        categoryId: sql`cm.value`,
        inflowToReadyToAssign: sql`l.inflow_to_ready_to_assign`,
        memo: sql`l.memo`,
        sort: sql`l.sort`,
        createdAt: now,
        updatedAt: now,
      },
      sql`from scheduled_subtransactions l
        join json_each(${schJson}) sm on sm.key = l.scheduled_transaction_id
        left join json_each(${payJson}) pm on pm.key = l.payee_id
        left join json_each(${catJson}) cm on cm.key = l.category_id
        where l.budget_id = ${ob} and l.deleted_at is null`,
    ),
  );
  // 16. one Starting Balance per copied account, dated today
  out.push(
    insertSelect(
      db,
      transactions,
      {
        id: uuidSql,
        budgetId: nb,
        accountId: accNew("am"),
        date: i.today,
        payeeName: "Starting Balance",
        inflowToReadyToAssign: sql.raw("json_extract(am.value, '$.rta')"),
        amount: sql.raw("json_extract(am.value, '$.amount')"),
        cleared: "cleared",
        approved: 1,
        createdAt: now,
        updatedAt: now,
        payeeId: sql`(select p.id from payees p where p.budget_id = ${nb} and p.system = 'starting_balance' and p.deleted_at is null)`,
      },
      sql`from json_each(${accJson}) am`,
    ),
  );
  // 17. ticked: the archive's links go, each with its history row (the log first, then the update)
  if (i.stopImporting) {
    out.push(
      logSelectStmt(
        db,
        { budgetId: ob, actor: i.actor, action: "update", entityType: "account", createdAt: now },
        sql`select id, bank_account_id, import_start_date, link_missing_since from accounts where ${linkedWhere}`,
        {
          entityId: sql`id`,
          before: sql`json_object('id', id, 'bank_account_id', bank_account_id, 'import_start_date', import_start_date, 'link_missing_since', link_missing_since)`,
          after: sql`json_object('id', id, 'bank_account_id', null, 'import_start_date', null, 'link_missing_since', null)`,
        },
      ),
      db
        .update(accounts)
        .set({ bankAccountId: null, importStartDate: null, linkMissingSince: null })
        .where(sql`${linkedWhere}`),
    );
  }
  // 18. change_log: the two plans' rows, then one `create transaction` per Starting Balance
  for (const e of i.logs) out.push(changeLogInsert(db, e));
  out.push(
    logSelectStmt(
      db,
      { budgetId: nb, actor: i.actor, action: "create", entityType: "transaction", createdAt: now },
      sql`select id, account_id, date, amount, payee_id, payee_name, inflow_to_ready_to_assign, cleared, approved from transactions where budget_id = ${nb}`,
      {
        entityId: sql`id`,
        before: null,
        after: sql`json_object('id', id, 'account_id', account_id, 'date', date, 'amount', amount, 'payee_id', payee_id, 'payee_name', payee_name, 'inflow_to_ready_to_assign', json(case when inflow_to_ready_to_assign then 'true' else 'false' end), 'cleared', cleared, 'approved', json(case when approved then 'true' else 'false' end))`,
      },
    ),
  );
  return out as unknown as Parameters<Db["batch"]>[0];
}
