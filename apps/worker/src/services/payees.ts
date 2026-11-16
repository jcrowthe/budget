import { compareNames, type Payee, type PayeeSystem } from "@budget/schema/payees";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as payeesRepo from "../repositories/payees";
import { TransactionRefused } from "./transactions";

type Db = ReturnType<typeof getDb>;

export function payeeToApi(row: payeesRepo.PayeeRow, lastCategoryId: string | null = null): Payee {
  return {
    id: row.id,
    name: row.name,
    hidden: row.hidden,
    system: row.system,
    last_category_id: lastCategoryId,
  };
}

export async function listPayees(
  env: Env,
  budgetId: string,
  opts: { q?: string; includeHidden?: boolean } = {},
): Promise<Payee[]> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const rows = await payeesRepo.listForPlan(db, budgetId, {
    includeHidden: opts.includeHidden ?? false,
  });
  const needle = opts.q?.toLowerCase() ?? "";
  return rows
    .filter((r) => needle === "" || r.name.toLowerCase().includes(needle))
    .map((r) => payeeToApi(r, r.lastCategoryId))
    .sort(compareNames);
}

export type ResolvedPayee = {
  payeeId: string | null;
  name: string | null;
  system: PayeeSystem | null;
  create?: payeesRepo.PayeeRow;
};

/**
 * The payee a request names: undefined when it names none. `payee_id` must be a payee of the plan (a system
 * one only when it is already the row's), `payee_name` matches an ordinary payee exactly or is created.
 */
export async function resolvePayee(
  db: Db,
  budgetId: string,
  input: { payee_id?: string | null; payee_name?: string | null },
  current?: string | null,
): Promise<ResolvedPayee | undefined> {
  const hasId = input.payee_id !== undefined;
  const hasName = input.payee_name !== undefined;
  if (hasId && hasName) {
    throw new TransactionRefused(
      422,
      "unprocessable_entity",
      "Give payee_id or payee_name, not both",
    );
  }
  if (hasId) {
    if (input.payee_id === null) return { payeeId: null, name: null, system: null };
    const p = await payeesRepo.findActive(db, budgetId, input.payee_id as string);
    if (!p)
      throw new TransactionRefused(422, "unprocessable_entity", "Payee not found in this plan");
    if (p.system && p.id !== current) {
      throw new TransactionRefused(422, "unprocessable_entity", "System payees are set by the app");
    }
    return { payeeId: p.id, name: p.name, system: p.system };
  }
  if (!hasName) return undefined;
  const name = input.payee_name?.trim() ?? "";
  if (name === "") return { payeeId: null, name: null, system: null };
  const found = await payeesRepo.findByName(db, budgetId, name);
  if (found) return { payeeId: found.id, name: found.name, system: null };
  const now = new Date().toISOString();
  const create: payeesRepo.PayeeRow = {
    id: crypto.randomUUID(),
    budgetId,
    name,
    hidden: false,
    system: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return { payeeId: create.id, name, system: null, create };
}
