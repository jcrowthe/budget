import { exportFormat } from "@budget/schema/plan-export";
import { planFormatter } from "@budget/schema/plan-formats";
import { exportFileName, registerCsv } from "@budget/schema/register-export";
import type { PlanTransaction } from "@budget/schema/transactions";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as txRepo from "../repositories/transactions";
import { formatsOfRow } from "./budgets";
import { TransactionRefused, transactionDetailToApi } from "./transactions";

/** The CSV of the given transactions (1 to 100), in the order given, and the file's name (UTC time). */
export async function exportTransactions(
  env: Env,
  budgetId: string,
  ids: readonly string[],
): Promise<{ csv: string; fileName: string }> {
  const db = getDb(env);
  const plan = await budgetsRepo.findActive(db, budgetId);
  if (!plan) throw new NotFound("Plan");
  const wanted = [...new Set(ids)];
  const rows = await txRepo.findDetailMany(db, budgetId, wanted);
  const lines = await txRepo.listLines(db, budgetId, { parentIds: wanted });
  const accounts = new Map(
    (await accountsRepo.list(db, budgetId, { includeClosed: true })).map((a) => [a.id, a.name]),
  );
  const out: PlanTransaction[] = wanted.map((id) => {
    const r = rows.get(id);
    if (!r) {
      throw new TransactionRefused(404, "not_found", `Transaction ${id}: not found in this plan`);
    }
    return {
      ...transactionDetailToApi(
        r,
        lines.filter((l) => l.parentTransactionId === id),
      ),
      account_name: accounts.get(r.accountId) ?? "",
    };
  });
  return {
    csv: registerCsv(out, exportFormat(planFormatter(formatsOfRow(plan)).planFormat())),
    fileName: exportFileName(plan.name, new Date(), "utc"),
  };
}
