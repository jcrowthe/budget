import {
  type AccountViewSettings,
  AccountViewSettingsUpdate,
  AllAccountsViewSettings,
  AllAccountsViewSettingsUpdate,
  mergeViewSettings,
  VIEW_DEFAULTS,
  type ViewSettings,
} from "@budget/schema/view-settings";
import { HTTPException } from "hono/http-exception";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as uiStateRepo from "../repositories/ui-state";
import * as repo from "../repositories/view-settings";

const ALL = "all_accounts";

/** The settings fields as stored: no account id. */
type Stored = Omit<AccountViewSettings, "account_id">;

/** Every field that does not parse falls back to its default. */
function parseStored(json: string | undefined): Stored {
  let raw: Record<string, unknown> = {};
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    if (v && typeof v === "object") raw = v as Record<string, unknown>;
  } catch {
    // bad JSON: defaults
  }
  const out: Record<string, unknown> = { ...VIEW_DEFAULTS };
  const shape = { ...AllAccountsViewSettings.shape, show_running_balance: undefined };
  for (const [k, schema] of Object.entries(shape)) {
    const p = schema?.safeParse(raw[k]);
    if (p?.success) out[k] = p.data;
  }
  if (typeof raw.show_running_balance === "boolean")
    out.show_running_balance = raw.show_running_balance;
  const s = out as unknown as Stored;
  // a custom range needs both months
  if (s.preset === "custom" && (!s.range_from || !s.range_to)) return { ...VIEW_DEFAULTS };
  if (s.preset !== "custom") return { ...s, range_from: null, range_to: null };
  return s;
}

const withoutBalance = ({
  show_running_balance: _,
  ...rest
}: Stored): Omit<Stored, "show_running_balance"> => rest;

async function readOne(env: Env, budgetId: string, accountId: string | null) {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  if (accountId && !(await accountsRepo.findActive(db, budgetId, accountId)))
    throw new NotFound("Account");
  const json = await repo.find(db, budgetId, repo.viewSettingsKey(accountId ?? ALL));
  return { db, json };
}

export async function getAccountViewSettings(
  env: Env,
  budgetId: string,
  accountId: string,
): Promise<AccountViewSettings> {
  const { json } = await readOne(env, budgetId, accountId);
  return { account_id: accountId, ...parseStored(json) };
}

export async function getAllAccountsViewSettings(env: Env, budgetId: string) {
  const { json } = await readOne(env, budgetId, null);
  return withoutBalance(parseStored(json));
}

async function write(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string | null,
  patch: Partial<ViewSettings>,
): Promise<Stored> {
  const { db, json } = await readOne(env, budgetId, accountId);
  const before = parseStored(json);
  const merged = mergeViewSettings(before, patch);
  if ("error" in merged) throw new HTTPException(422, { message: merged.error });
  const stored: Stored = accountId
    ? merged
    : { ...merged, show_running_balance: VIEW_DEFAULTS.show_running_balance };
  const shape = (s: Stored) => (accountId ? s : withoutBalance(s));
  await db.batch([
    uiStateRepo.upsertStmt(
      db,
      budgetId,
      repo.viewSettingsKey(accountId ?? ALL),
      JSON.stringify(shape(stored)),
      new Date().toISOString(),
    ),
    changeLogInsert(db, {
      budgetId,
      actor,
      action: json === undefined ? "create" : "update",
      entityType: "view_settings",
      entityId: accountId ?? ALL,
      before: shape(before),
      after: shape(stored),
    }),
  ]);
  return stored;
}

export async function updateAccountViewSettings(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
  patch: unknown,
): Promise<AccountViewSettings> {
  const v = AccountViewSettingsUpdate.safeParse(patch);
  if (!v.success)
    throw new HTTPException(422, { message: v.error.issues.map((i) => i.message).join("; ") });
  return { account_id: accountId, ...(await write(env, actor, budgetId, accountId, v.data)) };
}

export async function updateAllAccountsViewSettings(
  env: Env,
  actor: string,
  budgetId: string,
  patch: unknown,
) {
  const v = AllAccountsViewSettingsUpdate.safeParse(patch);
  if (!v.success)
    throw new HTTPException(422, { message: v.error.issues.map((i) => i.message).join("; ") });
  return withoutBalance(await write(env, actor, budgetId, null, v.data));
}
