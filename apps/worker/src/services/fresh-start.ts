import { startingBalanceFeedsReadyToAssign } from "@budget/core/account-types";
import {
  archivedPlanName,
  type FreshStartInput,
  FreshStartRequest,
  type FreshStartResult,
  PLAN_NAME_TAKEN,
  planNameTaken,
} from "@budget/schema/fresh-start";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { Conflict, NotFound } from "../middleware/errors";
import { bankBalanceToPlan } from "../plaid/amounts";
import * as repo from "../repositories/fresh-start";
import { BudgetRefused, toApi } from "./budgets";

const utcToday = () => new Date().toISOString().slice(0, 10);

/**
 * Make a Fresh Start (EXF-478): copies the plan's structure into a new plan that starts today and renames the old
 * plan as an archive, in ONE write batch after ONE read batch (docs/fresh-start-design.md). Not undoable: the
 * change set holds a `fresh_start` row, which `services/undo.ts` refuses.
 */
export async function freshStartBudget(
  env: Env,
  actor: string,
  budgetId: string,
  input: FreshStartRequest,
): Promise<FreshStartResult> {
  // The abort guard also trips on a change to any other plan (it holds the whole active-plan list, for the name
  // check), so a raced attempt reads again and retries; a real clash then ends as 422 and a plan that keeps
  // changing as 409. Without it a plan created in another tab, or a parallel e2e test, fails the copy.
  for (let attempt = 1; ; attempt++) {
    try {
      return await freshStartOnce(env, actor, budgetId, input);
    } catch (e) {
      if (!(e instanceof Conflict) || attempt >= FRESH_START_ATTEMPTS) throw e;
    }
  }
}

const FRESH_START_ATTEMPTS = 5;

async function freshStartOnce(
  env: Env,
  actor: string,
  budgetId: string,
  input: FreshStartRequest,
): Promise<FreshStartResult> {
  const v: FreshStartInput = FreshStartRequest.parse(input);
  const db = getDb(env);
  const [
    sourceRows,
    active,
    accountRows,
    groupRows,
    categoryRows,
    payeeRows,
    scheduleRows,
    subRows,
  ] = await db.batch(repo.readSourceStmts(db, budgetId));
  const source = sourceRows[0];
  if (!source) throw new NotFound("Plan");
  if (
    planNameTaken(
      active.map((p) => p.name),
      v.name,
    )
  ) {
    throw new BudgetRefused("plan_name_taken", PLAN_NAME_TAKEN);
  }
  const today = v.today ?? utcToday();
  const month = `${today.slice(0, 7)}-01`;
  const now = new Date().toISOString();
  const newId = crypto.randomUUID();
  const mapOf = (rows: { id: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.id, crypto.randomUUID()]));

  const accounts: repo.AccountMapEntry[] = accountRows.map((a) => {
    // A link whose bank_accounts row is gone is treated as unlinked: no link, $0.
    const linked = a.bankAccountId !== null && a.bankRowId !== null;
    return {
      old: a.id,
      new: crypto.randomUUID(),
      amount: linked ? bankBalanceToPlan(a.bankType ?? "", a.bankBalance ?? null) : 0,
      rta: startingBalanceFeedsReadyToAssign(a.type) ? 1 : 0,
      bank: linked ? a.bankAccountId : null,
    };
  });
  const linkedAsRead = JSON.stringify(
    accountRows
      .filter((a) => a.bankAccountId !== null)
      .map((a) => `${a.id}:${a.bankAccountId}:${a.linkMissingSince ?? ""}`),
  );
  const newBudget = {
    id: newId,
    name: v.name,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    lastOpenedAt: null,
    bankEnvironment: source.bankEnvironment,
    currencyIsoCode: source.currencyIsoCode,
    numberFormat: source.numberFormat,
    symbolPlacement: source.symbolPlacement,
    dateFormat: source.dateFormat,
    expectedIncome: source.expectedIncome,
    flagNames: source.flagNames,
  };
  const archiveName = archivedPlanName(source.name, today);
  const fresh = {
    new_budget_id: newId,
    archived_budget_id: budgetId,
    stop_importing_in_archive: v.stop_importing_in_archive,
    today,
  };
  const entry = (
    bid: string,
    action: "create" | "update",
    type: string,
    id: string,
    before: unknown,
    after: unknown,
  ) => ({
    budgetId: bid,
    actor,
    action,
    entityType: type,
    entityId: id,
    before,
    after,
  });
  const logs = [
    entry(newId, "create", "budget", newId, null, toApi(newBudget)),
    entry(
      budgetId,
      "update",
      "budget",
      budgetId,
      toApi(source),
      toApi({ ...source, name: archiveName, updatedAt: now }),
    ),
    entry(newId, "create", "fresh_start", newId, null, fresh),
    entry(budgetId, "create", "fresh_start", newId, null, fresh),
  ];
  try {
    await db.batch(
      repo.copyStmts(db, {
        oldId: budgetId,
        newId,
        now,
        today,
        month,
        archiveName,
        newBudget,
        source,
        activeBudgets: JSON.stringify(active.map((p) => `${p.id}:${p.name}`)),
        accounts,
        groups: mapOf(groupRows),
        categories: mapOf(categoryRows),
        payees: mapOf(payeeRows),
        schedules: mapOf(scheduleRows),
        subtransactionCount: subRows.length,
        linkedAsRead,
        stopImporting: v.stop_importing_in_archive,
        actor,
        startingPayeeId: crypto.randomUUID(),
        logs,
      }),
    );
  } catch (e) {
    if (repo.isFreshStartRaced(e)) throw new Conflict("Plan");
    throw e;
  }
  return { new_budget_id: newId, archived_budget_id: budgetId };
}
