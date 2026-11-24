import { MATCH_TEXT, matchLabel } from "@budget/schema/manual-match";
import { planFormatter } from "@budget/schema/plan-formats";
import type { MatchResult, UnmatchResult } from "@budget/schema/transactions";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import { recomputeDefaultsStmt } from "../repositories/payee-category";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import { formatsOfRow } from "./budgets";
import { resolvePayee } from "./payees";
import {
  activeAccount,
  activePlan,
  detailOf,
  detailsOf,
  logShape,
  MAX_ATTEMPTS,
  payeeInsert,
  TransactionRefused,
  transactionDetailToApi,
} from "./transactions";

/**
 * Manual match and unmatch (EXF-464). The rule is written here as the Worker's own code, in the order of the
 * design's tables; the schema package holds the same rule for the register's bar, and a test runs both.
 */
const notMatchable = (detail: string) => new TransactionRefused(422, "not_matchable", detail);
const reconciled = (detail: string) =>
  new TransactionRefused(409, "transaction_reconciled", detail);

const label = (r: txRepo.TransactionRow, fmt: Parameters<typeof matchLabel>[1]) =>
  matchLabel({ payee_name: r.payeeName, date: r.date, amount: r.amount }, fmt);

const isMatched = (r: txRepo.TransactionRow) => (r.importId ?? null) !== null && !r.source;

/**
 * Joins an unapproved import and a hand entry of one account into one transaction: the entry keeps its payee,
 * memo, date, category and flag and takes the bank's amount and bank fields; the import's row is deleted.
 */
export async function matchTransactions(
  env: Env,
  actor: string,
  budgetId: string,
  ids: readonly string[],
): Promise<MatchResult> {
  if (ids.length !== 2 || ids[0] === ids[1]) {
    throw new TransactionRefused(
      422,
      "unprocessable_entity",
      "Select exactly two different transactions to match",
    );
  }
  const db = getDb(env);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plan = await activePlan(db, budgetId);
    const fmt = planFormatter(formatsOfRow(plan));
    const found = await txRepo.findDetailMany(db, budgetId, ids);
    const a = found.get(ids[0] as string);
    const b = found.get(ids[1] as string);
    if (!a || !b) throw new NotFound("Transaction");
    const la = label(a, fmt);
    const lb = label(b, fmt);
    if (a.accountId !== b.accountId) throw notMatchable(MATCH_TEXT.differentAccounts(la, lb));
    const account = await activeAccount(db, budgetId, a.accountId);
    if (account.closed) throw new TransactionRefused(422, "account_closed", MATCH_TEXT.closedMatch);
    if (isMatched(a)) throw notMatchable(MATCH_TEXT.alreadyMatched(la));
    if (isMatched(b)) throw notMatchable(MATCH_TEXT.alreadyMatched(lb));
    const aImport = a.source === "plaid";
    if (aImport === (b.source === "plaid")) throw notMatchable(MATCH_TEXT.needOneOfEach);
    const [imp, entry] = aImport ? [a, b] : [b, a];
    const li = aImport ? la : lb;
    const le = aImport ? lb : la;
    if (imp.approved) throw notMatchable(MATCH_TEXT.importApproved(li));
    const impLines = await txRepo.listLines(db, budgetId, { parentIds: [entry.id, imp.id] });
    const entryLines = impLines.filter((l) => l.parentTransactionId === entry.id);
    if (impLines.some((l) => l.parentTransactionId === imp.id))
      throw notMatchable(MATCH_TEXT.importSplit(li));
    if (imp.transferAccountId) throw notMatchable(MATCH_TEXT.importTransfer(li));
    if (imp.cleared === "reconciled") throw reconciled(MATCH_TEXT.importReconciled(li));
    if (entry.amount !== imp.amount) {
      const t = fmt.money(entry.amount);
      const e = fmt.money(imp.amount);
      if (entryLines.length > 0) throw notMatchable(MATCH_TEXT.splitMismatch(t, e));
      if (entry.transferAccountId) throw notMatchable(MATCH_TEXT.transferMismatch(t, e));
      if (entry.cleared === "reconciled") throw reconciled(MATCH_TEXT.entryReconciled(le, e));
    }

    const now = new Date().toISOString();
    const set: txRepo.TxSet = {
      amount: imp.amount,
      importId: imp.importId,
      importedPayee: imp.importedPayee ?? null,
      bankDescription: imp.bankDescription ?? null,
      importDate: imp.importDate ?? null,
      importAmount: imp.importAmount ?? null,
      importPayeeName: imp.importPayeeName ?? null,
      matchEntryAmount: entry.amount,
      cleared: entry.cleared === "reconciled" ? "reconciled" : "cleared",
      approved: true,
      updatedAt: now,
    };
    const both = txRepo.allHold([txRepo.holdsAt(db, entry), txRepo.holdsAt(db, imp)]);
    const last = txRepo.allHold([txRepo.holdsAt(db, entry), txRepo.writtenAt(db, imp.id, now)]);
    const after = { ...entry, ...set } as typeof entry;
    const writes = [
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "transaction",
          entityId: entry.id,
          before: logShape(entry, entryLines),
          after: logShape(after, entryLines),
        },
        both,
      ),
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "delete",
          entityType: "transaction",
          entityId: imp.id,
          before: logShape(imp),
          after: null,
        },
        both,
      ),
      ...(entryLines.length > 0
        ? [
            txRepo.syncLinesIfStmt(
              db,
              entry.id,
              {
                accountId: entry.accountId,
                date: entry.date,
                cleared: set.cleared as "cleared" | "reconciled",
                approved: true,
                updatedAt: now,
              },
              both,
            ),
          ]
        : []),
      txRepo.softDeleteIfStmt(db, imp.id, now, both),
      txRepo.updateIfStmt(db, entry.id, set, last),
    ];
    // The success check reads the guarded update; the recompute of the payees' stored defaults follows it.
    const success = writes.length - 1;
    const recompute = recomputeDefaultsStmt(db, budgetId, [imp.payeeId, entry.payeeId]);
    const results = await db.batch([
      ...writes,
      ...(recompute ? [recompute] : []),
    ] as unknown as Parameters<typeof db.batch>[0]);
    const changes = (results[success] as { meta?: { changes?: number } } | undefined)?.meta
      ?.changes;
    if ((changes ?? 0) === 0) continue;
    return {
      transaction: await detailOf(db, budgetId, entry.id),
      removed: transactionDetailToApi(imp, []),
    };
  }
  throw new Conflict("Transaction");
}

/**
 * Gives a matched transaction back as two: the hand entry with the amount it had before the match, and the
 * bank's import as a new unapproved transaction with the same import id.
 */
export async function unmatchTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
): Promise<UnmatchResult> {
  const db = getDb(env);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plan = await activePlan(db, budgetId);
    const fmt = planFormatter(formatsOfRow(plan));
    const row = await txRepo.findDetail(db, budgetId, id);
    if (!row) throw new NotFound("Transaction");
    const rowLabel = label(row, fmt);
    const account = await activeAccount(db, budgetId, row.accountId);
    if (!isMatched(row))
      throw new TransactionRefused(422, "not_matched", MATCH_TEXT.notMatched(rowLabel));
    if (account.closed)
      throw new TransactionRefused(422, "account_closed", MATCH_TEXT.closedUnmatch);
    if (row.cleared === "reconciled") throw reconciled(MATCH_TEXT.unmatchReconciled(rowLabel));
    if (row.importDate == null || row.importAmount == null)
      throw new TransactionRefused(422, "not_matched", MATCH_TEXT.noBankCopy(rowLabel));
    const lines = await txRepo.listLines(db, budgetId, { parentIds: [row.id] });
    const payee = row.importPayeeName
      ? await resolvePayee(db, budgetId, { payee_name: row.importPayeeName })
      : undefined;
    const now = new Date().toISOString();
    const keepsAmount = lines.length > 0 || row.transferTransactionId;
    const set: txRepo.TxSet = {
      amount: keepsAmount ? row.amount : (row.matchEntryAmount ?? row.amount),
      importId: null,
      importedPayee: null,
      bankDescription: null,
      importDate: null,
      importAmount: null,
      importPayeeName: null,
      matchEntryAmount: null,
      cleared: "uncleared",
      updatedAt: now,
    };
    const newImport: txRepo.TransactionRow = {
      id: crypto.randomUUID(),
      budgetId,
      accountId: row.accountId,
      date: row.importDate,
      payeeId: payee?.payeeId ?? null,
      payeeName: payee?.name ?? null,
      categoryId: null,
      inflowToReadyToAssign: false,
      memo: null,
      amount: row.importAmount,
      cleared: "cleared",
      approved: false,
      createdAt: now,
      deletedAt: null,
      updatedAt: now,
      source: "plaid",
      importId: row.importId,
      importedPayee: row.importedPayee ?? null,
      bankDescription: row.bankDescription ?? null,
      importDate: row.importDate,
      importAmount: row.importAmount,
      importPayeeName: row.importPayeeName ?? null,
      flagColor: null,
    };
    const guard = txRepo.holdsAt(db, row);
    const recompute = recomputeDefaultsStmt(db, budgetId, [row.payeeId, payee?.payeeId]);
    const results = await (async () => {
      try {
        return await db.batch([
          // First, so the guarded insert whose `changes` is read below keeps its place from the end (before the recompute).
          ...payeesRepo.livePayeesCheck(db, budgetId, [payee?.create ? null : payee?.payeeId]),
          ...(payee?.create ? payeeInsert(db, actor, payee.create) : []),
          changeLogInsertIf(
            db,
            {
              budgetId,
              actor,
              action: "update",
              entityType: "transaction",
              entityId: row.id,
              before: logShape(row, lines),
              after: logShape({ ...row, ...set } as typeof row, lines),
            },
            guard,
          ),
          changeLogInsertIf(
            db,
            {
              budgetId,
              actor,
              action: "create",
              entityType: "transaction",
              entityId: newImport.id,
              before: null,
              after: logShape({ ...newImport, categoryName: null, groupName: null }),
            },
            guard,
          ),
          ...(lines.length > 0
            ? [
                txRepo.syncLinesIfStmt(
                  db,
                  row.id,
                  {
                    accountId: row.accountId,
                    date: row.date,
                    cleared: "uncleared",
                    approved: row.approved,
                    updatedAt: now,
                  },
                  guard,
                ),
              ]
            : []),
          txRepo.updateIfStmt(db, row.id, set, guard),
          txRepo.insertIfStmt(db, newImport, txRepo.writtenAt(db, row.id, now)),
          // Last: the stored defaults of the entry's payee and of the import's follow the new history.
          ...(recompute ? [recompute] : []),
        ] as unknown as Parameters<typeof db.batch>[0]);
      } catch (e) {
        if (payee?.create && payeesRepo.isUniqueViolation(e)) return null;
        if (payeesRepo.isPayeeGone(e)) return null;
        throw e;
      }
    })();
    if (!results) continue;
    const changes = (
      results[results.length - (recompute ? 2 : 1)] as { meta?: { changes?: number } } | undefined
    )?.meta?.changes;
    if ((changes ?? 0) === 0) continue;
    const [transaction, imported] = await detailsOf(db, budgetId, [row.id, newImport.id]);
    return { transaction: transaction as never, imported: imported as never };
  }
  throw new Conflict("Transaction");
}
