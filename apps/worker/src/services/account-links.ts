import {
  type Account,
  AccountLinkRequest,
  type AccountLinkRequest as AccountLinkRequestInput,
  AccountsFromBankRequest,
  type AccountsFromBankRequest as AccountsFromBankRequestInput,
  type AccountType,
} from "@budget/schema/accounts";
import { defaultAccountName, planAccountType } from "@budget/schema/bank-link";
import type { Transaction } from "@budget/schema/transactions";
import type { SQLWrapper } from "drizzle-orm";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import { bankBalanceToPlan } from "../plaid/amounts";
import * as accountsRepo from "../repositories/accounts";
import * as bankRepo from "../repositories/bank-connections";
import * as budgetsRepo from "../repositories/budgets";
import * as importsRepo from "../repositories/imports";
import {
  accountFacts,
  accountToApi,
  insertAccountWithStartingBalance,
  LinkRefused,
  NameTaken,
} from "./accounts";
import { getBudgetEnvironment } from "./budgets";

export { planAccountType };

const MAX_ATTEMPTS = 5;

type BatchItem = Parameters<Db["batch"]>[0][number];

/** UTC calendar arithmetic on YYYY-MM-DD. */
export function minusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const utcToday = () => new Date().toISOString().slice(0, 10);

const notLinkable = (what: string) =>
  new LinkRefused(422, "account_not_linkable", `A ${what} account cannot be linked`);

const taken = (name: string) =>
  new LinkRefused(
    409,
    "bank_account_already_linked",
    `This bank account is already linked to the account "${name}" in this plan`,
  );

async function planEnvironment(env: Env, budgetId: string) {
  if (!(await budgetsRepo.findActive(getDb(env), budgetId))) throw new NotFound("Plan");
  return getBudgetEnvironment(env, budgetId);
}

export async function createAccountsFromBank(
  env: Env,
  actor: string,
  budgetId: string,
  input: AccountsFromBankRequestInput,
): Promise<{ created: { account: Account; starting_balance: Transaction }[] }> {
  const v = AccountsFromBankRequest.parse(input);
  const db = getDb(env);
  const environment = await planEnvironment(env, budgetId);
  const today = v.today ?? utcToday();
  const plans: {
    bank: NonNullable<Awaited<ReturnType<typeof bankRepo.findBankAccountInEnvironment>>>;
    name: string;
    type: AccountType;
  }[] = [];
  for (const id of v.bank_account_ids) {
    const bank = await bankRepo.findBankAccountInEnvironment(db, environment, id);
    if (!bank) throw new NotFound("Bank account");
    const o = v.overrides?.[id];
    plans.push({
      bank,
      name: o?.name ?? defaultAccountName(bank),
      type: o?.type ?? planAccountType(bank.type, bank.subtype),
    });
  }
  for (const p of plans) if (p.type === "cash") throw notLinkable("cash");
  const links = await accountsRepo.linksForPlan(db, budgetId, v.bank_account_ids);
  for (const p of plans) {
    const holder = links.get(p.bank.id);
    if (holder) {
      const row = await accountsRepo.findActive(db, budgetId, holder);
      throw taken(row?.name ?? holder);
    }
  }
  const seen = new Set<string>();
  for (const p of plans) {
    const key = p.name.replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (seen.has(key) || (await accountsRepo.nameTaken(db, budgetId, p.name))) {
      throw new LinkRefused(409, "name_taken", `This account name already exists: ${p.name}`);
    }
    seen.add(key);
  }
  const created: { account: Account; starting_balance: Transaction }[] = [];
  for (const p of plans) {
    try {
      created.push(
        await insertAccountWithStartingBalance(env, actor, budgetId, {
          name: p.name,
          type: p.type,
          amount: bankBalanceToPlan(p.bank.type, p.bank.currentBalance),
          date: today,
          bankAccountId: p.bank.id,
          importStartDate: today,
          link: {
            connectionStatus: p.bank.connectionStatus,
            connectionSyncedAt: p.bank.connectionSyncedAt,
            connectionErrorCode: p.bank.connectionErrorCode,
          },
        }),
      );
    } catch (e) {
      if (e instanceof NameTaken) {
        throw new LinkRefused(409, "name_taken", `This account name already exists: ${p.name}`);
      }
      throw e;
    }
  }
  return { created };
}

async function balancesOf(db: Db, budgetId: string, row: accountsRepo.AccountRow) {
  return (await accountFacts(db, budgetId, row.id))(row);
}

/** The import start after a linked account's Starting Balance moves from `from` to `to` (YYYY-MM-DD). */
export function importStartAfterMove(current: string | null, from: string, to: string): string {
  if (to < from) return to;
  if (to > from) return current !== null && current > to ? current : to;
  return current ?? to;
}

/** Statements that move a linked account's import start inside another service's batch (none when unchanged). */
export async function importStartStmts(
  db: Db,
  actor: string,
  budgetId: string,
  account: accountsRepo.AccountRow,
  next: string,
  guard: SQLWrapper,
): Promise<{ stmts: BatchItem[]; holds: SQLWrapper; written: SQLWrapper } | null> {
  if (account.bankAccountId === null || next === account.importStartDate) return null;
  const b = (await accountFacts(db, budgetId, account.id))(account);
  return {
    stmts: [
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: account.id,
          before: accountToApi(account, b),
          after: accountToApi({ ...account, importStartDate: next }, b),
        },
        guard,
      ),
      accountsRepo.setImportStartIfStmt(db, account, next, guard),
    ],
    holds: accountsRepo.importStartHolds(db, account),
    written: accountsRepo.importStartIs(db, account, next),
  };
}

export async function linkAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
  input: AccountLinkRequestInput,
): Promise<Account> {
  const v = AccountLinkRequest.parse(input);
  const db = getDb(env);
  const environment = await planEnvironment(env, budgetId);
  const today = v.today ?? utcToday();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    const bank = await bankRepo.findBankAccountInEnvironment(db, environment, v.bank_account_id);
    if (!bank) throw new NotFound("Bank account");
    if (before.type === "cash") throw notLinkable("cash");
    if (before.closed) throw notLinkable("closed");
    // A link whose bank account the bank no longer lists (Account Not Found) may be replaced.
    if (before.bankAccountId !== null && before.linkMissingSince === null) {
      throw new LinkRefused(
        409,
        "account_already_linked",
        "This account is already linked to a bank account. Unlink it first.",
      );
    }
    const holder = await accountsRepo.findByBankAccount(db, budgetId, bank.id);
    if (holder) throw taken(holder.name);
    const reconciled = await accountsRepo.latestReconciledDate(db, accountId);
    const importStartDate = reconciled ? minusDays(reconciled, 3) : today;
    const balances = await balancesOf(db, budgetId, before);
    const after = {
      ...before,
      bankAccountId: bank.id,
      importStartDate,
      linkMissingSince: null,
      connectionStatus: bank.connectionStatus,
      connectionSyncedAt: bank.connectionSyncedAt,
      connectionErrorCode: bank.connectionErrorCode,
    };
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: accountId,
          before: accountToApi(before, balances),
          after: accountToApi(after, balances),
        },
        accountsRepo.linkHolds(db, before, bank.id),
      ),
      accountsRepo.setLinkIfStmt(db, before, bank.id, importStartDate),
    ]);
    if (result.meta.changes > 0) return accountToApi(after, balances);
  }
  throw new Conflict("Account");
}

export async function unlinkAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
): Promise<Account> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    const balances = await balancesOf(db, budgetId, before);
    if (before.bankAccountId === null) return accountToApi(before, balances);
    const after = {
      ...before,
      bankAccountId: null,
      importStartDate: null,
      linkMissingSince: null,
    };
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: accountId,
          before: accountToApi(before, balances),
          after: accountToApi(after, balances),
        },
        accountsRepo.unlinkHolds(db, before),
      ),
      accountsRepo.unlinkIfStmt(db, before),
    ]);
    if (result.meta.changes > 0) return accountToApi(after, balances);
  }
  throw new Conflict("Account");
}

/**
 * The statements that unlink every account linked to the connection, one guarded log row and one guarded
 * UPDATE per account as read (each holds only while the account still has the bank account it was read
 * with). They go into the removal's batch, which then guards its deletes on
 * `accountsRepo.noLinksToConnection`, so a link made or changed since the read loses the batch.
 */
export async function unlinkForConnectionStmts(
  db: Db,
  actor: string,
  connectionId: string,
): Promise<BatchItem[]> {
  const rows = await accountsRepo.linkedToConnection(db, connectionId);
  // A plan deleted before EXF-824 may still hold a link: it is unlinked, with no history row on the deleted plan.
  const live = rows.length
    ? await importsRepo.livePlanIds(db, [...new Set(rows.map((r) => r.budgetId))])
    : new Set<string>();
  const stmts: BatchItem[] = [];
  for (const row of rows) {
    if (!live.has(row.budgetId)) {
      stmts.push(accountsRepo.unlinkIfStmt(db, row));
      continue;
    }
    const balances = await balancesOf(db, row.budgetId, row);
    stmts.push(
      changeLogInsertIf(
        db,
        {
          budgetId: row.budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: row.id,
          before: accountToApi(row, balances),
          after: accountToApi(
            { ...row, bankAccountId: null, importStartDate: null, linkMissingSince: null },
            balances,
          ),
        },
        accountsRepo.unlinkHolds(db, row),
      ),
      accountsRepo.unlinkIfStmt(db, row),
    );
  }
  return stmts;
}
