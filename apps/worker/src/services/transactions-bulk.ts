import {
  TransactionBulkRequest,
  type TransactionBulkResult,
  type TransactionDetail,
  type TransactionUpdateRequest,
} from "@budget/schema/transactions";
import { transferCategoryRule } from "@budget/schema/transfers";
import type { SQLWrapper } from "drizzle-orm";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as txRepo from "../repositories/transactions";
import { newOtherSide } from "./transaction-pairs";
import {
  CLOSED_NO_MOVE,
  CLOSED_NO_NEW,
  CLOSED_OTHER,
  isCreditStartingBalance,
  logShape,
  type Plan,
  planWrites,
  prepare,
  type Reads,
  TransactionRefused,
  transactionDetailToApi,
} from "./transactions";

type Db = ReturnType<typeof getDb>;
type Skip = TransactionBulkResult["skipped"][number];
type Stmts = Parameters<Db["batch"]>[0];

/**
 * A plan over this many statements is refused. A batch is one D1 call whatever its size, so this does not protect the
 * per-invocation call limit; it bounds the size of one atomic batch (and of the statements the Worker builds).
 * A bulk request makes a fixed number of D1 calls whatever the number of rows: the plan check, one read of the
 * rows, their lines, the accounts, the other sides, the categories, then one batch and two set reads for the answer.
 */
export const BULK_MAX_STATEMENTS = 400;
const MAX_ATTEMPTS = 3;

/** One change to write: `self` is the statement that decides whether the whole batch applies. */
type Planned =
  | { kind: "update" | "delete"; id: string; plan: Plan }
  | {
      kind: "flag";
      id: string;
      before: txRepo.TransactionDetailRow;
      lines: txRepo.LineRow[];
      color: string | null;
    }
  | {
      kind: "duplicate";
      id: string;
      copyId: string;
      rows: txRepo.TransactionRow[];
      logs: ReturnType<typeof logShape>[];
    };

const distinct = (ids: readonly string[]) => [...new Set(ids)];
const clean = (v: string | null | undefined) => {
  const t = v?.trim() ?? "";
  return t === "" ? null : t;
};
const refuse = (status: 404 | 409 | 422, code: string, id: string, detail: string) =>
  new TransactionRefused(status, code, `Transaction ${id}: ${detail}`);
/** Re-throws a refusal of the single-edit rules with the id in front. */
const withId = (id: string, e: unknown): never => {
  if (e instanceof TransactionRefused) throw refuse(e.status, e.code, id, e.message);
  throw e;
};

/**
 * Applies one op to up to 100 transactions, all or nothing: every row is read and planned first (the first rule broken
 * refuses the whole request), then every statement runs in one D1 batch guarded by the rows as read.
 */
export async function bulkTransactions(
  env: Env,
  actor: string,
  budgetId: string,
  input: TransactionBulkRequest,
  hooks?: { beforeWrite?: () => Promise<void> },
): Promise<TransactionBulkResult> {
  const req = TransactionBulkRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const ids = distinct(req.ids);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await txRepo.findDetailMany(db, budgetId, ids);
    for (const id of ids) {
      if (!rows.has(id)) throw refuse(404, "not_found", id, "not found in this plan");
    }
    const lineList = await txRepo.listLines(db, budgetId, { parentIds: ids });
    const linesOf = new Map<string, txRepo.LineRow[]>();
    for (const l of lineList) {
      const k = l.parentTransactionId as string;
      linesOf.set(k, [...(linesOf.get(k) ?? []), l]);
    }
    const accounts = new Map(
      (await accountsRepo.list(db, budgetId, { includeClosed: true })).map((a) => [a.id, a]),
    );
    // Every other read the planner needs, in set queries, so no call is made inside the per-row loop.
    const otherSides = await txRepo.findDetailMany(
      db,
      budgetId,
      rows.size === 0
        ? []
        : [...rows.values()].flatMap((r) =>
            r.transferTransactionId ? [r.transferTransactionId] : [],
          ),
    );
    const categoryIds = new Set<string>();
    for (const r of [...rows.values(), ...otherSides.values()]) {
      if (r.categoryId) categoryIds.add(r.categoryId);
    }
    if (req.op === "categorize" && req.value !== "ready_to_assign") categoryIds.add(req.value);
    const categories = await txRepo.categoryNamesMany(db, budgetId, [...categoryIds]);
    const reads: Reads = { lines: linesOf, others: otherSides, accounts, categories };
    const now = new Date().toISOString();
    const idSet = new Set(ids);
    const planned: Planned[] = [];
    const skipped: Skip[] = [];
    const changed: string[] = [];
    const covered = new Set<string>(); // ids written as another plan's other side
    const copies: { id: string; copy_id: string }[] = [];
    const accountOf = (id: string, row: txRepo.TransactionRow) => {
      const a = accounts.get(row.accountId);
      if (!a) throw refuse(404, "not_found", id, "its account was not found");
      return a;
    };

    if (req.op === "categorize") {
      if (req.value !== "ready_to_assign" && !categories.has(req.value)) {
        throw refuse(
          422,
          "unprocessable_entity",
          ids[0] as string,
          "Category not found in this plan",
        );
      }
    }
    if (req.op === "move") {
      const target = accounts.get(req.value);
      if (!target)
        throw refuse(
          422,
          "unprocessable_entity",
          ids[0] as string,
          "Account not found in this plan",
        );
      if (target.closed) throw refuse(422, "account_closed", ids[0] as string, CLOSED_NO_MOVE);
    }

    for (const id of ids) {
      const row = rows.get(id) as txRepo.TransactionDetailRow;
      const lines = linesOf.get(id) ?? [];
      const account = accountOf(id, row);
      const skip = (reason: Skip["reason"]) => skipped.push({ id, reason });
      if (covered.has(id)) {
        changed.push(id);
        continue;
      }
      const planUpdate = async (patch: TransactionUpdateRequest) => {
        let plan: Plan;
        try {
          plan = await prepare(db, budgetId, row, account, "update", patch, now, { reads });
        } catch (e) {
          return withId(id, e);
        }
        if (plan.payeeCreates.length > 0) throw new Error("A bulk change must not create payees");
        // A memo follows to the other side, so that side needs no plan of its own; a clear or a move acts on
        // the selected side only.
        if (req.op === "memo")
          for (const o of plan.others) if (o.kind !== "insert") covered.add(o.before.id);
        planned.push({ kind: "update", id, plan });
        changed.push(id);
      };

      switch (req.op) {
        case "clear":
        case "unclear": {
          const to = req.op === "clear" ? "cleared" : "uncleared";
          if (row.cleared === "reconciled") skip("reconciled");
          else if (row.cleared === to) skip("unchanged");
          else {
            await planUpdate({ cleared: to });
          }
          break;
        }
        case "memo": {
          if (row.cleared === "reconciled") skip("reconciled");
          else if (clean(req.value) === (row.memo ?? null)) skip("unchanged");
          else await planUpdate({ memo: req.value });
          break;
        }
        case "categorize": {
          const other = row.transferAccountId ? accounts.get(row.transferAccountId) : undefined;
          if (row.cleared === "reconciled") skip("reconciled");
          else if (lines.length > 0) skip("split");
          else if (!account.onBudget) skip("tracking_account");
          else if (isCreditStartingBalance(account, row)) skip("starting_balance");
          else if (
            row.transferAccountId &&
            transferCategoryRule(
              { on_budget: account.onBudget },
              other ? { on_budget: other.onBudget } : null,
            ) === "not_needed"
          )
            skip("category_not_needed");
          else if (
            req.value === "ready_to_assign"
              ? row.inflowToReadyToAssign
              : row.categoryId === req.value
          )
            skip("unchanged");
          else
            await planUpdate(
              req.value === "ready_to_assign"
                ? { category_id: null, inflow_to_ready_to_assign: true }
                : { category_id: req.value },
            );
          break;
        }
        case "move": {
          const target = accounts.get(req.value) as accountsRepo.AccountRow;
          if (row.transferAccountId === target.id)
            throw refuse(
              422,
              "unprocessable_entity",
              id,
              "a transfer cannot be moved into its other account",
            );
          if (row.transferTransactionId && idSet.has(row.transferTransactionId))
            throw refuse(
              422,
              "unprocessable_entity",
              id,
              "both sides of a transfer cannot be moved together",
            );
          if (row.cleared === "reconciled") {
            skip("reconciled");
            break;
          }
          if (
            account.onBudget &&
            !target.onBudget &&
            (row.categoryId || row.inflowToReadyToAssign || lines.length > 0)
          )
            throw refuse(
              422,
              "unprocessable_entity",
              id,
              lines.length > 0
                ? `${target.name} is a tracking account, so its transactions can't be split. Make it a plain transaction first.`
                : `${target.name} is a tracking account, so its transactions can't have a category. Remove the category first.`,
            );
          if (row.accountId === target.id) skip("unchanged");
          else await planUpdate({ account_id: target.id });
          break;
        }
        case "delete": {
          if (row.cleared === "reconciled" && !req.confirm_reconciled)
            throw refuse(409, "transaction_reconciled", id, "this transaction is reconciled");
          let plan: Plan;
          try {
            plan = await prepare(db, budgetId, row, account, "delete", undefined, now, {
              allowReconciled: req.confirm_reconciled === true,
              reads,
            });
          } catch (e) {
            return withId(id, e);
          }
          for (const o of plan.others) if (o.kind !== "insert") covered.add(o.before.id);
          planned.push({ kind: "delete", id, plan });
          changed.push(id);
          break;
        }
        case "flag": {
          if ((row.flagColor ?? null) === req.value) skip("unchanged");
          else {
            planned.push({ kind: "flag", id, before: row, lines, color: req.value });
            changed.push(id);
          }
          break;
        }
        case "duplicate": {
          if (account.closed) throw refuse(422, "account_closed", id, CLOSED_NO_NEW);
          const other = row.transferAccountId ? accounts.get(row.transferAccountId) : undefined;
          if (row.transferAccountId && (!other || other.closed))
            throw refuse(422, "account_closed", id, CLOSED_OTHER);
          const copy: txRepo.TransactionRow = {
            id: crypto.randomUUID(),
            budgetId,
            accountId: row.accountId,
            date: row.date,
            payeeId: row.payeeId,
            payeeName: row.payeeName,
            categoryId: row.categoryId,
            inflowToReadyToAssign: row.inflowToReadyToAssign,
            memo: row.memo,
            amount: row.amount,
            cleared: row.cleared === "reconciled" ? "cleared" : row.cleared,
            approved: true,
            createdAt: now,
            deletedAt: null,
            updatedAt: now,
          };
          const out: txRepo.TransactionRow[] = [copy];
          const logs = [] as ReturnType<typeof logShape>[];
          const lineCopies = lines.map((l) => ({
            ...l,
            id: crypto.randomUUID(),
            parentTransactionId: copy.id,
            accountId: copy.accountId,
            date: copy.date,
            cleared: copy.cleared,
            approved: true,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            importId: null,
            source: null,
            importedPayee: null,
            bankDescription: null,
            importDate: null,
            importAmount: null,
            importPayeeName: null,
            flagColor: null,
            transferAccountId: null,
            transferTransactionId: null,
          }));
          out.push(...lineCopies);
          const names = { categoryName: row.categoryName, groupName: row.groupName };
          let side: txRepo.TransactionRow | undefined;
          if (row.transferAccountId && other) {
            copy.transferAccountId = row.transferAccountId;
            side = newOtherSide(copy, other.id, account.name, now);
            copy.transferTransactionId = side.id;
          }
          logs.push(logShape({ ...copy, ...names }, lineCopies));
          if (side && other) {
            out.push(side);
            logs.push(logShape({ ...side, categoryName: null, groupName: null }));
            if (row.transferTransactionId && idSet.has(row.transferTransactionId)) {
              covered.add(row.transferTransactionId);
              copies.push({ id: row.transferTransactionId, copy_id: side.id });
            }
          }
          copies.push({ id, copy_id: copy.id });
          planned.push({ kind: "duplicate", id, copyId: copy.id, rows: out, logs });
          changed.push(id);
          break;
        }
      }
    }

    if (req.op === "clear" || req.op === "unclear") {
      // A selected row's own plan already writes it (and approves it), so the other plan's mirror write of that
      // row is dropped: it would overwrite the new state with the one read, and log the row twice.
      // A selected row that was skipped has no plan of its own, so it keeps the other plan's write.
      const own = new Set(planned.filter((p) => p.kind === "update").map((p) => p.id));
      for (const p of planned) {
        if (p.kind !== "update") continue;
        p.plan.others = p.plan.others.filter((o) => o.kind === "insert" || !own.has(o.before.id));
        p.plan.logs = p.plan.logs.filter((l) => l.entityId === p.id || !own.has(l.entityId));
      }
    }

    if (planned.length === 0) {
      return { op: req.op, changed, skipped, others: [], copies: [], transactions: [] };
    }

    // The rows the plan read: the guard holds only while every one still has the updated_at it had then.
    const snap: { id: string; updatedAt: string }[] = [];
    for (const r of rows.values()) snap.push({ id: r.id, updatedAt: r.updatedAt });
    for (const l of lineList) snap.push({ id: l.id, updatedAt: l.updatedAt });
    for (const p of planned) {
      if (p.kind === "update" || p.kind === "delete") {
        for (const o of p.plan.others)
          if (o.kind !== "insert") snap.push({ id: o.before.id, updatedAt: o.before.updatedAt });
      }
    }
    const first = planned[0] as Planned;
    const gateId = first.kind === "duplicate" ? first.copyId : first.id;
    const g: SQLWrapper = txRepo.writtenAt(db, gateId, now);
    const snapGuard = txRepo.unchangedSince(db, snap);
    const logs: unknown[] = [];
    const rest: unknown[] = [];
    const selfs: unknown[] = [];
    let firstSelf: unknown;
    for (const [i, p] of planned.entries()) {
      const self = i === 0 ? snapGuard : g;
      let w: { payees: unknown[]; logs: unknown[]; rest: unknown[]; self: unknown } | undefined;
      if (p.kind === "update" || p.kind === "delete") {
        w = planWrites(db, {
          budgetId,
          actor,
          id: p.id,
          kind: p.kind,
          plan: p.plan,
          now,
          guard: g,
          selfGuard: self,
        });
      } else if (p.kind === "flag") {
        const after = { ...p.before, flagColor: p.color as never };
        w = {
          payees: [],
          logs: [
            changeLogInsertIf(
              db,
              {
                budgetId,
                actor,
                action: "update",
                entityType: "transaction",
                entityId: p.id,
                before: logShape(p.before, p.lines),
                after: logShape(after, p.lines),
              },
              g,
            ),
          ],
          rest: [],
          self: txRepo.updateIfStmt(
            db,
            p.id,
            { flagColor: p.color as never, updatedAt: now },
            self,
          ),
        };
      } else if (p.kind === "duplicate") {
        const [parent, ...others] = p.rows as [txRepo.TransactionRow, ...txRepo.TransactionRow[]];
        w = {
          payees: [],
          logs: p.logs.map((l) =>
            changeLogInsertIf(
              db,
              {
                budgetId,
                actor,
                action: "create",
                entityType: "transaction",
                entityId: l.id,
                before: null,
                after: l,
              },
              g,
            ),
          ),
          rest: others.map((r) => txRepo.insertIfStmt(db, r, g)),
          self: txRepo.insertIfStmt(db, parent, self),
        };
      }
      if (!w) continue;
      logs.push(...w.payees, ...w.logs);
      rest.push(...w.rest);
      if (i === 0) firstSelf = w.self;
      else selfs.push(w.self);
    }
    const statements = [firstSelf, ...logs, ...rest, ...selfs];
    if (statements.length > BULK_MAX_STATEMENTS) {
      throw new TransactionRefused(
        422,
        "too_many_changes",
        "Select fewer transactions: this change is too large for one request",
      );
    }
    await hooks?.beforeWrite?.();
    const results = await db.batch(statements as unknown as Stmts);
    if (((results[0] as { meta: { changes?: number } }).meta.changes ?? 0) === 0) continue;

    const others = distinct(
      planned.flatMap((p) =>
        p.kind === "update" || p.kind === "delete"
          ? p.plan.others.flatMap((o) => (o.kind === "insert" ? [] : [o.before.id]))
          : [],
      ),
    ).filter((id) => !changed.includes(id));
    return {
      op: req.op,
      changed,
      skipped,
      others,
      copies: req.op === "duplicate" ? ids.flatMap((id) => copies.filter((c) => c.id === id)) : [],
      transactions: await resultRows(db, budgetId, req.op, ids, changed, copies, planned, rows),
    };
  }
  throw new Conflict("Transaction");
}

async function resultRows(
  db: Db,
  budgetId: string,
  op: string,
  ids: string[],
  changed: string[],
  copies: { id: string; copy_id: string }[],
  planned: Planned[],
  before: Map<string, txRepo.TransactionDetailRow>,
): Promise<TransactionDetail[]> {
  if (op === "delete") {
    const lines = new Map<string, txRepo.LineRow[]>();
    for (const p of planned) if (p.kind === "delete") lines.set(p.id, p.plan.beforeLines);
    return changed.map((id) =>
      transactionDetailToApi(before.get(id) as txRepo.TransactionDetailRow, lines.get(id) ?? []),
    );
  }
  const want =
    op === "duplicate"
      ? distinct(ids.flatMap((id) => copies.filter((c) => c.id === id).map((c) => c.copy_id)))
      : changed;
  const rows = await txRepo.findDetailMany(db, budgetId, want);
  const ls = await txRepo.listLines(db, budgetId, { parentIds: want });
  return want.flatMap((id) => {
    const r = rows.get(id);
    return r
      ? [
          transactionDetailToApi(
            r,
            ls.filter((l) => l.parentTransactionId === id),
          ),
        ]
      : [];
  });
}
