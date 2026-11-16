import { isLoanType, isOnBudget } from "@budget/core/account-types";
import type { SyncResult } from "@budget/schema/bank-connections";
import {
  bankDescriptionOf,
  categoryFor,
  DUE_AFTER_MS,
  isRecoveryDuplicate,
  linkSet,
  linksCovered,
  MATCH_WINDOW_DAYS,
  minusDays,
  modifiedPlan,
  NEEDS_REPAIR,
  netChanges,
  type PlaidTxn,
  payeeNameOf,
  pickMatch,
  removedPlan,
  type SkipReason,
  type SyncStatus,
  skipReason,
  syncStatusForError,
} from "@budget/schema/plaid-import";
import type { SQLWrapper } from "drizzle-orm";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import { plaidToMilliunits } from "../plaid/amounts";
import { PlaidApiError, plaidFor } from "../plaid/client";
import { PlaidNotSetUp } from "../plaid/credentials";
import { getAccessToken } from "../plaid/tokens";
import { type BalanceAccount, fetchBalances, fetchSyncPages } from "../plaid/transactions";
import * as accountsRepo from "../repositories/accounts";
import * as bankRepo from "../repositories/bank-connections";
import * as budgetsRepo from "../repositories/budgets";
import * as importsRepo from "../repositories/imports";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import { toApi } from "./bank-connections";
import { runGroups, type StatementGroup } from "./batch-groups";
import { getBudgetEnvironment } from "./budgets";
import { logShape, namesOf } from "./transactions";

/** Who a bank sync writes as, whoever asked for it. */
export const PLAID_ACTOR = "service:plaid";
export const MAX_RUNS_PER_CONNECTION = 5;

type Kind = "added" | "matched" | "modified" | "removed";
type Row = txRepo.TransactionRow;

const empty = (row: bankRepo.BankConnectionRow, status: string): SyncResult => ({
  bank_connection_id: row.id,
  status: status as SyncResult["status"],
  added: 0,
  matched: 0,
  modified: 0,
  removed: 0,
  skipped: 0,
  has_more: false,
  last_synced_at: row.lastSyncedAt,
});

const milli = (amount: number) => 0 - (plaidToMilliunits(amount) as number);

/** Saves only the connection's status (and the start of an outage), with its change_log row. */
async function storeStatus(
  db: Db,
  row: bankRepo.BankConnectionRow,
  accounts: bankRepo.BankAccountRow[],
  status: SyncStatus,
  now: string,
) {
  const syncErrorSince = row.syncErrorSince ?? now;
  if (row.status === status && row.syncErrorSince === syncErrorSince) return;
  const guard = bankRepo.cursorIs(db, row.id, row.syncCursor);
  await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: null,
        actor: PLAID_ACTOR,
        action: "update",
        entityType: "bank_connection",
        entityId: row.id,
        before: toApi(row, accounts),
        after: toApi({ ...row, status, updatedAt: now }, accounts),
      },
      guard,
    ),
    bankRepo.updateConnectionStmt(db, row.id, { status, syncErrorSince, updatedAt: now }, guard),
  ]);
}

interface PlanAccount {
  account: accountsRepo.AccountRow;
  bank: bankRepo.BankAccountRow;
}

/** One run of the sync of one connection. Throws on anything that is not the bank's answer. */
export async function runSync(
  env: Env,
  connectionId: string,
  opts: { maxUpdates?: number; maxPages?: number } = {},
): Promise<SyncResult> {
  const db = getDb(env);
  const row = await bankRepo.findById(db, connectionId);
  if (!row) throw new NotFound("Bank connection");
  if ((NEEDS_REPAIR as readonly string[]).includes(row.status)) return empty(row, row.status);
  const bankAccounts = await bankRepo.accountsOf(db, row.id);
  const now = new Date().toISOString();

  const token = await getAccessToken(env, row.id);
  if (!token) {
    await storeStatus(db, row, bankAccounts, "broken", now);
    return empty(row, "broken");
  }
  let plaid: Awaited<ReturnType<typeof plaidFor>>;
  try {
    plaid = await plaidFor(env, row.environment);
  } catch (e) {
    if (e instanceof PlaidNotSetUp) return empty(row, "not_set_up");
    throw e;
  }

  // Links: the open accounts of live plans that are linked to a bank account of this connection.
  const bankById = new Map(bankAccounts.map((b) => [b.id, b]));
  const live = new Map<string, boolean>();
  const linked: PlanAccount[] = [];
  for (const a of await accountsRepo.linkedToConnection(db, row.id)) {
    if (!live.has(a.budgetId))
      live.set(a.budgetId, !!(await budgetsRepo.findActive(db, a.budgetId)));
    const bank = a.bankAccountId ? bankById.get(a.bankAccountId) : undefined;
    if (live.get(a.budgetId) && bank) linked.push({ account: a, bank });
  }
  const open = linked.filter((l) => !l.account.closed);
  const links = linkSet(open.map((l) => l.account));
  const fresh = !linksCovered(links, row.syncAccounts);
  const startCursor = fresh ? null : row.syncCursor;
  const loopCursor = fresh ? "" : row.syncLoopCursor;

  let pages: Awaited<ReturnType<typeof fetchSyncPages>> | null = null;
  let balances: BalanceAccount[];
  try {
    if (open.length > 0) {
      pages = await fetchSyncPages(plaid, token, startCursor, loopCursor, opts);
    }
    balances = await fetchBalances(plaid, token);
  } catch (e) {
    if (!(e instanceof PlaidApiError)) throw e;
    const status = syncStatusForError(e.status, e.errorCode);
    await storeStatus(db, row, bankAccounts, status, now);
    return empty(row, status);
  }

  const counts: Record<Kind | "skipped", number> = {
    added: 0,
    matched: 0,
    modified: 0,
    removed: 0,
    skipped: 0,
  };
  const groups: Group[] = [];

  if (pages) {
    const { upserts, removed } = netChanges(pages.pages);
    const recovery = row.syncErrorSince !== null;
    const payeesOf = new Map<string, Map<string, { lastCategoryId: string | null }>>();
    const planPayees = async (budgetId: string) => {
      let p = payeesOf.get(budgetId);
      if (!p) {
        const list = await payeesRepo.listForPlan(db, budgetId, { includeHidden: true });
        p = new Map(
          list
            .filter((x) => x.system === null)
            .map((x) => [x.name, { lastCategoryId: x.lastCategoryId }]),
        );
        payeesOf.set(budgetId, p);
      }
      return p;
    };
    const sorted = [...upserts].sort(
      (a, b) =>
        a.txn.date.localeCompare(b.txn.date) ||
        a.txn.transaction_id.localeCompare(b.txn.transaction_id),
    );

    for (const { account, bank } of open) {
      const mine = sorted.filter((u) => u.txn.account_id === bank.plaidAccountId);
      if (mine.length === 0) continue;
      const budgetId = account.budgetId;
      const payees = await planPayees(budgetId);
      const ids = mine.map((u) => u.txn.transaction_id);
      const idSet = new Set(ids);
      const [tombstoned, existingRows, startingBalanceDate, latestReconciledDate] =
        await Promise.all([
          importsRepo.tombstonedIds(db, budgetId, ids),
          importsRepo.rowsByImportId(db, budgetId, ids),
          accountsRepo.startingBalanceDate(db, account.id),
          accountsRepo.latestReconciledDate(db, account.id),
        ]);
      const existing = new Map(existingRows.map((r) => [r.importId as string, r]));
      const dates = mine.map((u) => u.txn.date);
      const lo = dates.reduce((a, b) => (a < b ? a : b));
      const hi = dates.reduce((a, b) => (a > b ? a : b));
      const candidates = await importsRepo.matchCandidates(
        db,
        account.id,
        minusDays(lo, MATCH_WINDOW_DAYS),
        minusDays(hi, -MATCH_WINDOW_DAYS),
      );
      const candidateList = candidates.map((c) => ({
        id: c.id,
        date: c.date,
        amount: c.amount,
        createdAt: c.createdAt,
      }));
      const recent = recovery
        ? (await importsRepo.liveDateAmounts(db, account.id, lo, hi))
            .filter((r) => !r.importId || !idSet.has(r.importId))
            .map((r) => ({ date: r.date, amount: r.amount }))
        : [];
      const rules = {
        closed: account.closed,
        importStartDate: account.importStartDate,
        startingBalanceDate,
        latestReconciledDate,
      };
      const kinds = {
        takesCategory: isOnBudget(account.type) && !isLoanType(account.type),
        rtaInflow: account.type === "checking" || account.type === "savings",
      };
      const used = new Set<string>();

      for (const { txn } of mine) {
        const have = existing.get(txn.transaction_id);
        if (have) {
          const g = await followBank(db, budgetId, have, txn, now);
          if (g) groups.push(g);
          continue;
        }
        if (skipReason(txn, rules, tombstoned.has(txn.transaction_id))) {
          counts.skipped++;
          continue;
        }
        const amount = milli(txn.amount);
        const payeeName = payeeNameOf(txn);
        const pick = pickMatch({ date: txn.date, amount }, candidateList, used);
        const notKnown = importsRepo.notKnownSql(budgetId, txn.transaction_id);
        if (!pick && recovery && isRecoveryDuplicate({ date: txn.date, amount }, recent)) {
          counts.skipped++;
          const g = new Group();
          g.add(
            importsRepo.tombstoneIfStmt(
              db,
              {
                accountId: account.id,
                importId: txn.transaction_id,
                budgetId,
                reason: "duplicate",
                transactionId: null,
              },
              notKnown,
              now,
            ),
          );
          groups.push(g);
          continue;
        }
        const g = new Group();
        const guard = txRepo.allHold([
          notKnown,
          importsRepo.accountLinkedOpenSql(account.id, bank.id),
        ]);
        const bankValues = importValues(txn, amount, payeeName);
        if (pick) {
          used.add(pick);
          const c = (candidates.find((x) => x.id === pick) as importsRepo.MatchCandidate).row;
          const cleared = c.cleared === "reconciled" ? "reconciled" : "cleared";
          const matchGuard = txRepo.allHold([txRepo.holdsAt(db, c), guard]);
          const lines = await txRepo.listLines(db, budgetId, { parentId: c.id });
          const before = await txRepo.findDetail(db, budgetId, c.id);
          const names = {
            categoryName: before?.categoryName ?? null,
            groupName: before?.groupName ?? null,
          };
          const after: Row = { ...c, ...bankValues, cleared, approved: true, updatedAt: now };
          g.add(
            changeLogInsertIf(
              db,
              {
                budgetId,
                actor: PLAID_ACTOR,
                action: "update",
                entityType: "transaction",
                entityId: c.id,
                before: logShape({ ...c, ...names }, lines),
                after: logShape({ ...after, ...names }, lines),
              },
              matchGuard,
            ),
          );
          if (lines.length > 0) {
            g.add(
              txRepo.syncLinesIfStmt(
                db,
                c.id,
                { accountId: c.accountId, date: c.date, cleared, approved: true, updatedAt: now },
                matchGuard,
              ),
            );
          }
          // The row's own write comes last: it changes updated_at, which the guards above rest on.
          g.add(
            txRepo.updateIfStmt(
              db,
              c.id,
              { ...bankValues, cleared, approved: true, updatedAt: now },
              matchGuard,
            ),
            "matched",
          );
        }
        // The insert: the import itself, or the fallback of a match whose candidate changed meanwhile.
        // Once the match is written the id is known, and every statement below is a no-op.
        const cat = categoryFor(kinds, amount, payeeName ? (payees.get(payeeName) ?? null) : null);
        const newRow: Row = {
          id: crypto.randomUUID(),
          budgetId,
          accountId: account.id,
          date: txn.date,
          payeeId: null,
          payeeName,
          categoryId: cat.categoryId,
          inflowToReadyToAssign: cat.inflowToReadyToAssign,
          memo: null,
          amount,
          cleared: "cleared",
          approved: false,
          createdAt: now,
          deletedAt: null,
          updatedAt: now,
          ...bankValues,
          source: "plaid",
        };
        if (payeeName) addPayee(db, g, budgetId, payeeName, now, guard);
        const names = await txRepoNames(db, budgetId, cat.categoryId);
        g.add(
          changeLogInsertIf(
            db,
            {
              budgetId,
              actor: PLAID_ACTOR,
              action: "create",
              entityType: "transaction",
              entityId: newRow.id,
              before: null,
              after: logShape({ ...newRow, ...names }),
            },
            guard,
          ),
        );
        g.add(
          txRepo.insertIfStmt(
            db,
            newRow,
            guard,
            payeeName ? payeesRepo.ordinaryIdByNameSql(budgetId, payeeName) : undefined,
          ),
          "added",
        );
        groups.push(g);
      }
    }

    // The bank withdrew these: an unapproved import goes (no tombstone: it may come back).
    if (removed.length > 0) {
      for (const budgetId of new Set(open.map((l) => l.account.budgetId))) {
        for (const r of await importsRepo.rowsByImportId(db, budgetId, removed)) {
          if (removedPlan(r) !== "delete") continue;
          const full = await txRepo.findDetail(db, budgetId, r.id);
          if (!full) continue;
          const lines = await txRepo.listLines(db, budgetId, { parentId: r.id });
          const guard = txRepo.writtenAt(db, r.id, r.updatedAt);
          const g = new Group();
          g.add(
            changeLogInsertIf(
              db,
              {
                budgetId,
                actor: PLAID_ACTOR,
                action: "delete",
                entityType: "transaction",
                entityId: r.id,
                before: logShape(full, lines),
                after: null,
              },
              guard,
            ),
          );
          g.add(txRepo.softDeleteLinesIfStmt(db, r.id, now, guard));
          g.add(txRepo.softDeleteIfStmt(db, r.id, now, guard), "removed");
          groups.push(g);
        }
      }
    }
  }

  // The writes of the sync come first, in batches that are each safe to repeat.
  const results = await runGroups(
    db,
    groups.map((g) => g.stmts),
  );
  for (const [i, changes] of results.entries()) {
    for (const [j, kind] of (groups[i]?.kinds ?? []).entries()) {
      if (kind && (changes[j] ?? 0) > 0) counts[kind]++;
    }
  }

  // The cursor, the sync time, the status and the balances come last, in one batch.
  const finished = new Date().toISOString();
  const guard = bankRepo.cursorIs(db, row.id, row.syncCursor);
  const after = {
    ...row,
    status: "connected",
    lastSyncedAt: finished,
    updatedAt: finished,
  };
  const byPlaidId = new Map(balances.map((b) => [b.account_id, b]));
  const final: unknown[] = [];
  if (row.status !== "connected") {
    final.push(
      changeLogInsertIf(
        db,
        {
          budgetId: null,
          actor: PLAID_ACTOR,
          action: "update",
          entityType: "bank_connection",
          entityId: row.id,
          before: toApi(row, bankAccounts),
          after: toApi(after, bankAccounts),
        },
        guard,
      ),
    );
  }
  for (const b of bankAccounts) {
    const got = byPlaidId.get(b.plaidAccountId);
    if (!got) continue;
    final.push(
      bankRepo.updateBalancesStmt(
        db,
        b.id,
        {
          current: plaidToMilliunits(got.balances.current),
          available: plaidToMilliunits(got.balances.available),
          at: got.balances.last_updated_datetime ?? finished,
        },
        guard,
      ),
    );
  }
  final.push(
    bankRepo.updateConnectionStmt(
      db,
      row.id,
      {
        ...(pages
          ? {
              syncCursor: pages.nextCursor,
              syncLoopCursor: pages.hasMore ? (loopCursor ?? startCursor ?? "") : null,
            }
          : {}),
        syncAccounts: links,
        lastSyncedAt: finished,
        status: "connected",
        syncErrorSince: null,
        updatedAt: finished,
      },
      guard,
    ),
  );
  const [last] = await runGroups(db, [final], Number.MAX_SAFE_INTEGER);
  if (((last ?? [])[final.length - 1] ?? 0) === 0) throw new Error("sync conflict");
  return {
    bank_connection_id: row.id,
    status: "connected",
    ...counts,
    has_more: pages?.hasMore ?? false,
    last_synced_at: finished,
  };
}

/** The columns of an import that are the bank's, as the row stores them. */
function importValues(txn: PlaidTxn, amount: number, payeeName: string | null) {
  return {
    importId: txn.transaction_id,
    importedPayee: txn.name,
    bankDescription: bankDescriptionOf(txn),
    importDate: txn.date,
    importAmount: amount,
    importPayeeName: payeeName,
  };
}

async function txRepoNames(db: Db, budgetId: string, categoryId: string | null) {
  return namesOf(db, budgetId, categoryId);
}

/** A group of statements with the kind of change each one counts, when it changes a row. */
class Group {
  stmts: unknown[] = [];
  kinds: (Kind | "")[] = [];
  add(stmt: unknown, kind: Kind | "" = "") {
    this.stmts.push(stmt);
    this.kinds.push(kind);
  }
}

/** The payee, created once if the plan has none of that name (and its change_log row), while `guard` holds. */
function addPayee(
  db: Db,
  g: Group,
  budgetId: string,
  name: string,
  now: string,
  guard: SQLWrapper,
) {
  const p: payeesRepo.PayeeRow = {
    id: crypto.randomUUID(),
    budgetId,
    name,
    hidden: false,
    system: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  g.add(
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor: PLAID_ACTOR,
        action: "create",
        entityType: "payee",
        entityId: p.id,
        before: null,
        after: { id: p.id, name: p.name, hidden: p.hidden, system: p.system },
      },
      txRepo.allHold([guard, payeesRepo.missingByNameGuard(budgetId, name)]),
    ),
  );
  g.add(payeesRepo.insertByNameIfMissingStmt(db, p));
}

/**
 * An entry whose id is already on a live row of the plan: never an insert. A reconciled row takes only the
 * bank's description; an unapproved import follows the bank; anything else keeps the user's values and takes
 * the description and the bank's own copies. Nothing differs: no statement.
 */
async function followBank(
  db: Db,
  budgetId: string,
  have: Row,
  txn: PlaidTxn,
  now: string,
): Promise<Group | null> {
  const how = modifiedPlan(have);
  const amount = milli(txn.amount);
  const payeeName = payeeNameOf(txn);
  const set: txRepo.TxSet = {};
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  if (!same(have.bankDescription, bankDescriptionOf(txn)))
    set.bankDescription = bankDescriptionOf(txn);
  if (how !== "bank_description_only") {
    if (!same(have.importDate, txn.date)) set.importDate = txn.date;
    if (!same(have.importAmount, amount)) set.importAmount = amount;
    if (!same(have.importPayeeName, payeeName)) set.importPayeeName = payeeName;
    if (!same(have.importedPayee, txn.name)) set.importedPayee = txn.name;
  }
  let newPayee: string | null = null;
  if (how === "follow") {
    if (!same(have.date, txn.date)) set.date = txn.date;
    if (!same(have.amount, amount)) set.amount = amount;
    if (!same(have.importPayeeName, payeeName)) {
      set.payeeName = payeeName;
      set.payeeId = payeeName ? payeesRepo.ordinaryIdByNameSql(budgetId, payeeName) : null;
      newPayee = payeeName;
    }
  }
  if (Object.keys(set).length === 0) return null;
  const guard = txRepo.writtenAt(db, have.id, have.updatedAt);
  const before = await txRepo.findDetail(db, budgetId, have.id);
  const lines = await txRepo.listLines(db, budgetId, { parentId: have.id });
  const names = {
    categoryName: before?.categoryName ?? null,
    groupName: before?.groupName ?? null,
  };
  const merged = {
    ...have,
    ...set,
    payeeId: newPayee ? null : set.payeeId === null ? null : have.payeeId,
  } as Row;
  const g = new Group();
  if (newPayee) addPayee(db, g, budgetId, newPayee, now, guard);
  g.add(
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor: PLAID_ACTOR,
        action: "update",
        entityType: "transaction",
        entityId: have.id,
        before: logShape({ ...have, ...names }, lines),
        after: logShape({ ...merged, ...names }, lines),
      },
      guard,
    ),
  );
  g.add(txRepo.updateIfStmt(db, have.id, { ...set, updatedAt: now }, guard), "modified");
  return g;
}

/** One run through the connection's Durable Object: a request during a run shares that run. */
export async function requestSync(env: Env, conn: bankRepo.BankConnectionRow): Promise<SyncResult> {
  const stub = env.PLAID_ITEM_SYNC.get(env.PLAID_ITEM_SYNC.idFromName(conn.plaidItemId));
  const res = await stub.fetch("https://plaid-item-sync/run", {
    method: "POST",
    body: JSON.stringify({ connection_id: conn.id }),
  });
  if (!res.ok) throw new Error("sync failed");
  return (await res.json()) as SyncResult;
}

/** A sync of one connection of the plan's environment (another environment's is "not found"). */
export async function syncBankConnection(
  env: Env,
  budgetId: string,
  id: string,
): Promise<SyncResult> {
  const e = await getBudgetEnvironment(env, budgetId);
  const found = await bankRepo.getInEnvironment(getDb(env), e, id);
  if (!found) throw new NotFound("Bank connection");
  return requestSync(env, found.row);
}

/** A sync of each connection linked to an account of the plan, in turn. */
export async function syncPlan(env: Env, budgetId: string): Promise<{ results: SyncResult[] }> {
  const e = await getBudgetEnvironment(env, budgetId);
  const rows = await bankRepo.listForPlanLinks(getDb(env), budgetId, e);
  const results: SyncResult[] = [];
  for (const row of rows) results.push(await requestSync(env, row));
  return { results };
}

/** The scheduled sync: every connection never synced or not synced for 6 hours, whatever the cron's rate. */
export async function syncDueConnections(env: Env, now: Date = new Date()): Promise<SyncResult[]> {
  const due = await bankRepo.listDue(
    getDb(env),
    new Date(now.getTime() - DUE_AFTER_MS).toISOString(),
  );
  const out: SyncResult[] = [];
  for (const conn of due) {
    try {
      for (let i = 0; i < MAX_RUNS_PER_CONNECTION; i++) {
        const r = await requestSync(env, conn);
        out.push(r);
        if (!r.has_more) break;
      }
    } catch {
      // One connection's failure must not stop the next; only its id is logged.
      console.error(`sync failed for connection ${conn.id}`);
    }
  }
  return out;
}
