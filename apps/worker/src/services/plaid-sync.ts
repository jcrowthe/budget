import { isLoanType, isOnBudget } from "@budget/core/account-types";
import type { SyncResult } from "@budget/schema/bank-connections";
import {
  bankDescriptionOf,
  CHECK_AFTER_MS,
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
  SCHEDULED_MAX_RUNS,
  SCHEDULED_WALL_MS,
  type SkipReason,
  SYNC_UNIT_SIZE,
  type SyncStatus,
  skipReason,
  storedErrorCode,
  syncStatusForError,
} from "@budget/schema/plaid-import";
import { and, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import { changeLog } from "../db/schema/change-log";
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
import * as importsRepo from "../repositories/imports";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import { toApi } from "./bank-connections";
import { batchCount, runGroups } from "./batch-groups";
import { getBudgetEnvironment } from "./budgets";
import { CallBudget, countedEnv, countedPlaid, SyncBudgetTooSmall } from "./sync-budget";
import { logShape } from "./transactions";

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
  code: string | null,
) {
  const syncErrorSince = row.syncErrorSince ?? now;
  const syncErrorCode = storedErrorCode(code);
  if (
    row.status === status &&
    row.syncErrorSince === syncErrorSince &&
    row.syncErrorCode === syncErrorCode
  )
    return;
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
        after: toApi({ ...row, status, syncErrorCode, updatedAt: now }, accounts),
      },
      guard,
    ),
    bankRepo.updateConnectionStmt(
      db,
      row.id,
      { status, syncErrorSince, syncErrorCode, updatedAt: now },
      guard,
    ),
  ]);
}

interface PlanAccount {
  account: accountsRepo.AccountRow;
  bank: bankRepo.BankAccountRow;
}

type Stmts = Parameters<Db["batch"]>[0];

const forNewRow = (n: importsRepo.CategoryNames, id: string | null) => {
  const c = id ? n.get(id) : undefined;
  return c && !c.deleted
    ? { categoryName: c.name, groupName: c.groupName }
    : { categoryName: null, groupName: null };
};

const forExisting = (n: importsRepo.CategoryNames, id: string | null) => {
  const c = id ? n.get(id) : undefined;
  return c
    ? { categoryName: c.name, groupName: c.groupName }
    : { categoryName: null, groupName: null };
};

/**
 * One run of the sync of one connection. Throws on anything that is not the bank's answer, after leaving the
 * connection `delayed` with `sync_failed_at`. A run stays inside a budget of D1 and Plaid calls (Cloudflare's
 * per-invocation limits): when it is used up the run stops, writes what it has, keeps the cursor and reports
 * `has_more`.
 */
export async function runSync(
  env: Env,
  connectionId: string,
  opts: { maxUpdates?: number; maxPages?: number; callBudget?: number; check?: boolean } = {},
): Promise<SyncResult> {
  const budget = new CallBudget(opts.callBudget);
  const cenv = countedEnv(env, budget);
  const db = getDb(cenv);
  const row = await bankRepo.findById(db, connectionId);
  if (!row) throw new NotFound("Bank connection");
  const accounts: { list: bankRepo.BankAccountRow[] } = { list: [] };
  try {
    return await syncConnection(cenv, db, budget, row, accounts, opts);
  } catch (e) {
    await recordFailure(db, row, accounts.list, budget).catch(() => {});
    throw e;
  }
}

/** Leaves the connection `delayed` with the time of the failure (a needed repair is never hidden). No cursor. */
async function recordFailure(
  db: Db,
  row: bankRepo.BankConnectionRow,
  accounts: bankRepo.BankAccountRow[],
  budget: CallBudget,
) {
  budget.failing();
  const now = new Date().toISOString();
  const guard = bankRepo.failureMayBeRecorded(db, row.id);
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
        after: toApi(
          { ...row, status: "delayed", syncFailedAt: now, syncErrorCode: null, updatedAt: now },
          accounts,
        ),
      },
      guard,
    ),
    bankRepo.updateConnectionStmt(
      db,
      row.id,
      { status: "delayed", syncFailedAt: now, syncErrorCode: null, updatedAt: now },
      guard,
    ),
  ]);
}

async function syncConnection(
  env: Env,
  db: Db,
  budget: CallBudget,
  row: bankRepo.BankConnectionRow,
  holder: { list: bankRepo.BankAccountRow[] },
  opts: { maxUpdates?: number; maxPages?: number; check?: boolean },
): Promise<SyncResult> {
  // Only the nightly check (`opts.check`) looks again at a connection that needs a sign-in; never a broken one.
  const checking = opts.check === true && row.status === "login_required";
  if ((NEEDS_REPAIR as readonly string[]).includes(row.status) && !checking) {
    return empty(row, row.status);
  }
  const bankAccounts = await bankRepo.accountsOf(db, row.id);
  holder.list = bankAccounts;
  const now = new Date().toISOString();

  const token = await getAccessToken(env, row.id);
  if (!token) {
    await storeStatus(db, row, bankAccounts, "broken", now, null);
    return empty(row, "broken");
  }
  let plaid: Awaited<ReturnType<typeof plaidFor>>;
  try {
    plaid = countedPlaid(await plaidFor(env, row.environment), budget);
  } catch (e) {
    if (e instanceof PlaidNotSetUp) return empty(row, "not_set_up");
    throw e;
  }

  // The nightly check: one call. A refusal leaves everything as it is but the time of this try; a good
  // answer is the bank's list, which the sync below reuses.
  let checked: BalanceAccount[] | null = null;
  if (checking) {
    try {
      checked = await fetchBalances(plaid, token);
    } catch (e) {
      if (!(e instanceof PlaidApiError)) throw e;
      await bankRepo.checkedStmt(db, row.id, now);
      return empty(row, "login_required");
    }
  }

  // Links: the open accounts of live plans that are linked to a bank account of this connection.
  const bankById = new Map(bankAccounts.map((b) => [b.id, b]));
  const linkedRows = await accountsRepo.linkedToConnection(db, row.id);
  const live = await importsRepo.livePlanIds(db, [...new Set(linkedRows.map((a) => a.budgetId))]);
  const linked: PlanAccount[] = [];
  for (const a of linkedRows) {
    const bank = a.bankAccountId ? bankById.get(a.bankAccountId) : undefined;
    if (live.has(a.budgetId) && bank) linked.push({ account: a, bank });
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
    balances = checked ?? (await fetchBalances(plaid, token));
  } catch (e) {
    if (!(e instanceof PlaidApiError)) throw e;
    const status = syncStatusForError(e.status, e.errorCode);
    await storeStatus(db, row, bankAccounts, status, now, e.errorCode);
    return empty(row, status);
  }

  const counts: Record<Kind | "skipped", number> = {
    added: 0,
    matched: 0,
    modified: 0,
    removed: 0,
    skipped: 0,
  };
  let stopped = false;
  let wrote = false;

  /** Writes the longest prefix of the groups that still leaves room for the final batch. */
  const write = async (groups: Group[]) => {
    let k = groups.length;
    while (
      k > 0 &&
      batchCount(groups.slice(0, k).map((g) => g.stmts.length)) > budget.batchesLeft()
    )
      k--;
    if (k < groups.length) stopped = true;
    if (k === 0) return;
    const written = groups.slice(0, k);
    const results = await runGroups(
      db,
      written.map((g) => g.stmts),
    );
    wrote = true;
    for (const [i, changes] of results.entries()) {
      for (const [j, kind] of (written[i]?.kinds ?? []).entries()) {
        if (kind && (changes[j] ?? 0) > 0) counts[kind]++;
      }
    }
  };

  if (pages) {
    const { upserts, removed } = netChanges(pages.pages);
    const recovery = row.syncErrorSince !== null;
    const payeesOf = new Map<string, PayeeMap>();
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

    // What each account with entries needs, read in one batch with the plans' category names.
    const work = open
      .map(({ account, bank }) => ({
        account,
        bank,
        mine: sorted.filter((u) => u.txn.account_id === bank.plaidAccountId),
      }))
      .filter((w) => w.mine.length > 0);
    const planIds = [...new Set(work.map((w) => w.account.budgetId))];
    for (const id of planIds) await planPayees(id);
    const queries: unknown[] = [];
    const at = work.map(({ account, mine }) => {
      const dates = mine.map((u) => u.txn.date);
      const lo = dates.reduce((a, b) => (a < b ? a : b));
      const hi = dates.reduce((a, b) => (a > b ? a : b));
      const slot = {
        lo,
        hi,
        start: queries.length,
        recent: -1,
      };
      queries.push(
        accountsRepo.startingBalanceDateQuery(db, account.id),
        accountsRepo.latestReconciledDateQuery(db, account.id),
        importsRepo.matchCandidatesQuery(
          db,
          account.id,
          minusDays(lo, MATCH_WINDOW_DAYS),
          minusDays(hi, -MATCH_WINDOW_DAYS),
        ),
      );
      if (recovery) {
        slot.recent = queries.length;
        queries.push(importsRepo.liveDateAmountsQuery(db, account.id, lo, hi));
      }
      return slot;
    });
    const namesAt = new Map(planIds.map((id) => [id, queries.length + planIds.indexOf(id)]));
    for (const id of planIds) queries.push(importsRepo.categoryNamesQuery(db, id));
    const got =
      queries.length > 0
        ? ((await db.batch(queries as unknown as Stmts)) as unknown as unknown[][])
        : [];
    const namesOfPlan = new Map(
      planIds.map((id) => [
        id,
        importsRepo.toCategoryNames(
          (got[namesAt.get(id) as number] ?? []) as Parameters<
            typeof importsRepo.toCategoryNames
          >[0],
        ),
      ]),
    );

    units: for (const [w, { account, bank, mine }] of work.entries()) {
      const slot = at[w] as (typeof at)[number];
      const budgetId = account.budgetId;
      const payees = payeesOf.get(budgetId) as PayeeMap;
      const names = namesOfPlan.get(budgetId) as importsRepo.CategoryNames;
      const idSet = new Set(mine.map((u) => u.txn.transaction_id));
      const startingBalanceDate =
        (got[slot.start] as { d: string | null }[] | undefined)?.[0]?.d ?? null;
      const latestReconciledDate =
        (got[slot.start + 1] as { d: string | null }[] | undefined)?.[0]?.d ?? null;
      const candidates = ((got[slot.start + 2] ?? []) as Row[]).map(importsRepo.toCandidate);
      const candidateById = new Map(candidates.map((c) => [c.id, c]));
      const candidateList = candidates.map((c) => ({
        id: c.id,
        date: c.date,
        amount: c.amount,
        createdAt: c.createdAt,
      }));
      const recent =
        slot.recent >= 0
          ? (
              (got[slot.recent] ?? []) as {
                date: string;
                amount: number;
                importId: string | null;
              }[]
            )
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

      for (const unit of importsRepo.chunked(mine, SYNC_UNIT_SIZE)) {
        // Room for: the read batch, a lines read, one write batch and the final batch.
        if (!budget.fits(3)) {
          stopped = true;
          break units;
        }
        const ids = unit.map((u) => u.txn.transaction_id);
        const [tombRows, existingRows] = (await db.batch([
          importsRepo.tombstonesQuery(db, budgetId, ids),
          importsRepo.rowsByImportIdQuery(db, budgetId, ids),
        ] as unknown as Stmts)) as [{ id: string }[], Row[]];
        const tombstoned = new Set(tombRows.map((r) => r.id));
        const existing = new Map(existingRows.map((r) => [r.importId as string, r]));

        // Decide first (no reads), then read the lines of every parent the unit changes, then build.
        type Decision =
          | { kind: "follow"; have: Row; plan: NonNullable<ReturnType<typeof followPlan>> }
          | { kind: "tombstone"; txn: PlaidTxn; amount: number; notKnown: SQLWrapper }
          | { kind: "import"; txn: PlaidTxn; amount: number; pick: string | null };
        const decisions: Decision[] = [];
        for (const { txn } of unit) {
          const have = existing.get(txn.transaction_id);
          if (have) {
            const plan = followPlan(budgetId, have, txn);
            if (plan) decisions.push({ kind: "follow", have, plan });
            continue;
          }
          if (skipReason(txn, rules, tombstoned.has(txn.transaction_id))) {
            counts.skipped++;
            continue;
          }
          const amount = milli(txn.amount);
          const pick = pickMatch({ date: txn.date, amount }, candidateList, used);
          if (pick) used.add(pick);
          if (!pick && recovery && isRecoveryDuplicate({ date: txn.date, amount }, recent)) {
            counts.skipped++;
            decisions.push({
              kind: "tombstone",
              txn,
              amount,
              notKnown: importsRepo.notKnownSql(budgetId, txn.transaction_id),
            });
            continue;
          }
          decisions.push({ kind: "import", txn, amount, pick });
        }
        const parentIds = decisions.flatMap((d) =>
          d.kind === "follow" ? [d.have.id] : d.kind === "import" && d.pick ? [d.pick] : [],
        );
        const lineRows = await txRepo.listLines(db, budgetId, { parentIds });
        const linesOf = (id: string) => lineRows.filter((l) => l.parentTransactionId === id);

        const groups: Group[] = [];
        for (const d of decisions) {
          if (d.kind === "follow") {
            groups.push(
              followBank(
                db,
                budgetId,
                d.have,
                d.plan,
                forExisting(names, d.have.categoryId),
                linesOf(d.have.id),
                now,
              ),
            );
            continue;
          }
          if (d.kind === "tombstone") {
            const g = new Group();
            g.add(
              importsRepo.tombstoneIfStmt(
                db,
                {
                  accountId: account.id,
                  importId: d.txn.transaction_id,
                  budgetId,
                  reason: "duplicate",
                  transactionId: null,
                },
                d.notKnown,
                now,
              ),
            );
            groups.push(g);
            continue;
          }
          const { txn, amount, pick } = d;
          const payeeName = payeeNameOf(txn);
          const notKnown = importsRepo.notKnownSql(budgetId, txn.transaction_id);
          const g = new Group();
          const guard = txRepo.allHold([
            notKnown,
            importsRepo.accountLinkedOpenSql(account.id, bank.id),
          ]);
          const bankValues = importValues(txn, amount, payeeName);
          if (pick) {
            const c = (candidateById.get(pick) as importsRepo.MatchCandidate).row;
            const cleared = c.cleared === "reconciled" ? "reconciled" : "cleared";
            const matchGuard = txRepo.allHold([txRepo.holdsAt(db, c), guard]);
            const lines = linesOf(c.id);
            const catNames = forExisting(names, c.categoryId);
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
                  before: logShape({ ...c, ...catNames }, lines),
                  after: logShape({ ...after, ...catNames }, lines),
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
          const cat = categoryFor(
            kinds,
            amount,
            payeeName ? (payees.get(payeeName) ?? null) : null,
          );
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
                after: logShape({ ...newRow, ...forNewRow(names, cat.categoryId) }),
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
          if (payeeName) {
            g.add(
              logPayeeIdStmt(
                db,
                newRow.id,
                "create",
                budgetId,
                payeeName,
                txRepo.writtenAt(db, newRow.id, now),
              ),
            );
          }
          groups.push(g);
        }
        await write(groups);
        if (stopped) break units;
      }
    }

    // The bank withdrew these: an unapproved import goes (no tombstone: it may come back).
    if (removed.length > 0 && !stopped) {
      removal: for (const budgetId of new Set(open.map((l) => l.account.budgetId))) {
        for (const slice of importsRepo.chunked(removed, SYNC_UNIT_SIZE)) {
          if (!budget.fits(1)) {
            stopped = true;
            break removal;
          }
          const groups: Group[] = [];
          for (const r of await importsRepo.rowsByImportId(db, budgetId, slice)) {
            if (removedPlan(r) !== "delete") continue;
            // Two reads, one write batch and the final batch: a group is always written.
            if (!budget.fits(3)) {
              stopped = true;
              break;
            }
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
          await write(groups);
          if (stopped) break removal;
        }
      }
    }
  }
  // Nothing written and nothing left to try: the next run would stop at the same place.
  if (stopped && !wrote) throw new SyncBudgetTooSmall();

  // The cursor, the sync time, the status and the balances come last, in one batch.
  const finished = new Date().toISOString();
  const guard = bankRepo.cursorIs(db, row.id, row.syncCursor);
  const after = {
    ...row,
    status: "connected",
    lastSyncedAt: finished,
    syncFailedAt: null,
    syncErrorCode: null,
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
  // Only this good list marks anything: a link whose bank account the bank no longer lists reads Account Not Found.
  if (linkedRows.length > 0) {
    const missing = bankAccounts.filter((b) => !byPlaidId.has(b.plaidAccountId)).map((b) => b.id);
    final.push(accountsRepo.markMissingStmt(db, row.id, missing, finished, guard));
  }
  final.push(
    bankRepo.updateConnectionStmt(
      db,
      row.id,
      stopped
        ? {
            lastSyncedAt: finished,
            status: "connected",
            syncFailedAt: null,
            syncErrorCode: null,
            updatedAt: finished,
          }
        : {
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
            syncFailedAt: null,
            syncErrorCode: null,
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
    has_more: stopped || (pages?.hasMore ?? false),
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

/** A group of statements with the kind of change each one counts, when it changes a row. */
type PayeeMap = Map<string, { lastCategoryId: string | null }>;

/**
 * Fills `payee_id` in the newest change_log copy of the transaction with the payee its row points to (the
 * row's payee_id is resolved by name in SQL), while `guard` holds.
 */
function logPayeeIdStmt(
  db: Db,
  transactionId: string,
  action: "create" | "update",
  budgetId: string,
  name: string,
  guard: SQLWrapper,
) {
  return db
    .update(changeLog)
    .set({
      afterJson: sql`json_set(${changeLog.afterJson}, '$.payee_id', ${payeesRepo.ordinaryIdByNameSql(budgetId, name)})`,
    })
    .where(
      and(
        sql`${changeLog.id} = (select c.id from change_log c where c.entity_type = 'transaction' and c.entity_id = ${transactionId} and c.action = ${action} order by c.rowid desc limit 1)`,
        sql`exists ${guard}`,
      ),
    );
}

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
): void {
  const p: payeesRepo.PayeeRow = {
    // Always a fresh id: a known payee may have been renamed or merged since it was read.
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
  g.add(payeesRepo.insertByNameIfMissingStmt(db, p, guard));
}

/**
 * An entry whose id is already on a live row of the plan: never an insert. A reconciled row takes only the
 * bank's description; an unapproved import follows the bank; anything else keeps the user's values and takes
 * the description and the bank's own copies. Nothing differs: null.
 */
function followPlan(budgetId: string, have: Row, txn: PlaidTxn) {
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
  return Object.keys(set).length === 0 ? null : { set, newPayee };
}

function followBank(
  db: Db,
  budgetId: string,
  have: Row,
  plan: { set: txRepo.TxSet; newPayee: string | null },
  names: { categoryName: string | null; groupName: string | null },
  lines: txRepo.LineRow[],
  now: string,
): Group {
  const { set, newPayee } = plan;
  const guard = txRepo.writtenAt(db, have.id, have.updatedAt);
  const g = new Group();
  if (newPayee) addPayee(db, g, budgetId, newPayee, now, guard);
  const merged = {
    ...have,
    ...set,
    payeeId: newPayee ? null : set.payeeId === null ? null : have.payeeId,
  } as Row;
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
  if (newPayee) {
    g.add(
      logPayeeIdStmt(db, have.id, "update", budgetId, newPayee, txRepo.writtenAt(db, have.id, now)),
    );
  }
  return g;
}

/** One run through the connection's Durable Object: a request during a run shares that run. */
export async function requestSync(
  env: Env,
  conn: bankRepo.BankConnectionRow,
  opts: { check?: boolean } = {},
): Promise<SyncResult> {
  const stub = env.PLAID_ITEM_SYNC.get(env.PLAID_ITEM_SYNC.idFromName(conn.plaidItemId));
  const res = await stub.fetch("https://plaid-item-sync/run", {
    method: "POST",
    body: JSON.stringify({ connection_id: conn.id, check: opts.check === true }),
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

/**
 * The scheduled sync: every connection never synced or not synced for 6 hours, whatever the cron's rate.
 * Round-robin, so every due connection makes progress: each run is its own Durable Object request, and one
 * invocation starts at most SCHEDULED_MAX_RUNS of them, none after SCHEDULED_WALL_MS.
 */
export async function syncDueConnections(
  env: Env,
  now: Date = new Date(),
  run: typeof requestSync = requestSync,
  opts: { maxRuns?: number } = {},
): Promise<SyncResult[]> {
  const maxRuns = opts.maxRuns ?? SCHEDULED_MAX_RUNS;
  let active = await bankRepo.listDue(
    getDb(env),
    new Date(now.getTime() - DUE_AFTER_MS).toISOString(),
  );
  const out: SyncResult[] = [];
  const started = Date.now();
  let runs = 0;
  for (let round = 0; round < MAX_RUNS_PER_CONNECTION && active.length > 0; round++) {
    const next: typeof active = [];
    for (const conn of active) {
      if (runs >= maxRuns || Date.now() - started >= SCHEDULED_WALL_MS) return out;
      runs++;
      try {
        const r = await run(env, conn);
        out.push(r);
        if (r.has_more) next.push(conn);
      } catch {
        // One connection's failure must not stop the next; only its id is logged.
        console.error(`sync failed for connection ${conn.id}`);
      }
    }
    active = next;
  }
  // What is left of the budget goes to the sign-ins that may have healed: a dead connection never takes a
  // healthy one's run. One call each; an error leaves everything but its time.
  if (runs < maxRuns && Date.now() - started < SCHEDULED_WALL_MS) {
    const toCheck = await bankRepo.listToCheck(
      getDb(env),
      new Date(now.getTime() - CHECK_AFTER_MS).toISOString(),
      maxRuns - runs,
    );
    for (const conn of toCheck) {
      if (runs >= maxRuns || Date.now() - started >= SCHEDULED_WALL_MS) break;
      runs++;
      try {
        out.push(await run(env, conn, { check: true }));
      } catch {
        console.error(`sync failed for connection ${conn.id}`);
      }
    }
  }
  return out;
}
