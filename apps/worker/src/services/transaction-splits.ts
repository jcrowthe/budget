import { formatMoney } from "@budget/core/money";
import { splitSum } from "@budget/schema/split";
import type { SubTransactionInput } from "@budget/schema/transactions";
import type { getDb } from "../db/client";
import type * as accountsRepo from "../repositories/accounts";
import * as categoriesRepo from "../repositories/categories";
import type * as payeesRepo from "../repositories/payees";
import type { TransactionRow } from "../repositories/transactions";
import { type ResolvedPayee, resolvePayee } from "./payees";
import { TransactionRefused } from "./transactions";

type Db = ReturnType<typeof getDb>;

const unprocessable = (detail: string) =>
  new TransactionRefused(422, "unprocessable_entity", detail);

const clean = (v: string | null | undefined) => {
  const t = v?.trim() ?? "";
  return t === "" ? null : t;
};

/**
 * Checks the lines of a split and returns them as rows (account, date, cleared and approved copied from the
 * parent) plus the payees to create, one per distinct new name.
 */
export async function validateLines(
  db: Db,
  budgetId: string,
  parent: TransactionRow,
  lines: readonly SubTransactionInput[],
  account: accountsRepo.AccountRow,
  now: string,
  parentPayee?: ResolvedPayee,
): Promise<{ rows: TransactionRow[]; payeeCreates: payeesRepo.PayeeRow[] }> {
  if (!account.onBudget) throw unprocessable("A tracking account's transactions cannot be split");
  if (lines.length < 2) throw unprocessable("A split needs at least two lines");
  const created = new Map<string, ResolvedPayee>();
  const payeeCreates: payeesRepo.PayeeRow[] = [];
  if (parentPayee?.create) created.set(parentPayee.create.name, parentPayee);
  const rows: TransactionRow[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.category_id && line.inflow_to_ready_to_assign) {
      throw unprocessable(
        "A transaction cannot have both a category and the Ready to Assign inflow flag",
      );
    }
    if (line.category_id && !(await categoriesRepo.findActive(db, budgetId, line.category_id))) {
      throw unprocessable("Category not found in this plan");
    }
    const name = line.payee_name?.trim();
    let payee: ResolvedPayee | undefined = name ? created.get(name) : undefined;
    if (payee) {
      payee = { payeeId: payee.payeeId, name: payee.name, system: null };
    } else {
      payee = await resolvePayee(db, budgetId, {
        payee_id: line.payee_id,
        payee_name: line.payee_name,
      });
      if (payee?.create) {
        created.set(payee.create.name, payee);
        payeeCreates.push(payee.create);
      }
    }
    rows.push({
      id: crypto.randomUUID(),
      budgetId,
      accountId: parent.accountId,
      date: parent.date,
      payeeId: payee?.payeeId ?? null,
      payeeName: payee?.name ?? null,
      categoryId: line.category_id ?? null,
      inflowToReadyToAssign: line.inflow_to_ready_to_assign ?? false,
      memo: clean(line.memo),
      amount: line.amount,
      cleared: parent.cleared,
      approved: parent.approved,
      createdAt: now,
      deletedAt: null,
      updatedAt: now,
      parentTransactionId: parent.id,
      splitIndex: i,
    });
  }
  const sum = splitSum(rows.map((r) => r.amount));
  if (sum !== parent.amount) {
    throw unprocessable(
      `The splits add up to ${formatMoney(sum)} but the amount is ${formatMoney(parent.amount)}`,
    );
  }
  return { rows, payeeCreates };
}
