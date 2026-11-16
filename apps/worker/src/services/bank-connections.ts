import type { BankConnection, BankConnectionCreate } from "@budget/schema/bank-connections";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import { plaidToMilliunits } from "../plaid/amounts";
import {
  ITEM_GONE_CODES,
  linkTokenRequest,
  linkTokenUpdateRequest,
  PlaidApiError,
  plaidFor,
} from "../plaid/client";
import type { PlaidInstitution } from "../plaid/institutions";
import { deleteAccessToken, getAccessToken, storeAccessToken } from "../plaid/tokens";
import * as accountsRepo from "../repositories/accounts";
import * as repo from "../repositories/bank-connections";
import { unlinkForConnectionStmts } from "./account-links";
import { getBudgetEnvironment } from "./budgets";

export function toApi(
  row: repo.BankConnectionRow,
  accounts: repo.BankAccountRow[],
  links: Map<string, string> = new Map(),
): BankConnection {
  return {
    id: row.id,
    display_id: row.displayId,
    environment: row.environment,
    institution_id: row.institutionId,
    institution_name: row.institutionName,
    institution_logo: row.institutionLogo,
    nickname: row.nickname,
    status: row.status,
    provider: row.provider,
    last_synced_at: row.lastSyncedAt,
    last_reset_at: row.lastResetAt,
    created_at: row.createdAt,
    accounts: accounts.map((a) => ({
      id: a.id,
      bank_connection_id: a.bankConnectionId,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current_balance: a.currentBalance,
      available_balance: a.availableBalance,
      balance_updated_at: a.balanceUpdatedAt,
      linked_account_id: links.get(a.id) ?? null,
    })),
  };
}

export async function listBankConnections(env: Env, budgetId: string): Promise<BankConnection[]> {
  const e = await getBudgetEnvironment(env, budgetId);
  const db = getDb(env);
  const found = await repo.listByEnvironment(db, e);
  const links = await accountsRepo.linksForPlan(
    db,
    budgetId,
    found.flatMap((r) => r.accounts.map((a) => a.id)),
  );
  return found.map((r) => toApi(r.row, r.accounts, links));
}

export async function createLinkToken(env: Env, budgetId: string) {
  const e = await getBudgetEnvironment(env, budgetId);
  const plaid = await plaidFor(env, e);
  const res = await plaid.post<{ link_token: string; expiration: string }>(
    "/link/token/create",
    linkTokenRequest(e, env.PUBLIC_HOSTNAME),
  );
  return { link_token: res.link_token, expiration: res.expiration };
}

interface PlaidAccount {
  account_id: string;
  name: string;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: {
    current?: number | null;
    available?: number | null;
    last_updated_datetime?: string | null;
  };
}

function randomDisplayId(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function createBankConnection(
  env: Env,
  actor: string,
  input: BankConnectionCreate,
): Promise<BankConnection> {
  const e = await getBudgetEnvironment(env, input.budget_id);
  const plaid = await plaidFor(env, e);
  const exchange = await plaid.post<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token: input.public_token },
  );
  const accessToken = exchange.access_token;
  const id = crypto.randomUUID();
  try {
    const got = await plaid.post<{
      accounts: PlaidAccount[];
      item: { institution_id?: string | null };
    }>("/accounts/get", { access_token: accessToken });
    const institutionId = got.item.institution_id ?? input.institution_id;
    let name = input.institution_name ?? institutionId;
    let logo: string | null = null;
    try {
      const ins = await plaid.post<{ institution: PlaidInstitution }>("/institutions/get_by_id", {
        institution_id: institutionId,
        country_codes: ["US"],
        options: { include_optional_metadata: true },
      });
      name = ins.institution.name;
      logo = ins.institution.logo ? `data:image/png;base64,${ins.institution.logo}` : null;
    } catch {
      // keep the fallback name
    }
    await storeAccessToken(env, id, accessToken);
    const db = getDb(env);
    const now = new Date().toISOString();
    const accountRows: repo.BankAccountRow[] = got.accounts.map((a) => ({
      id: crypto.randomUUID(),
      bankConnectionId: id,
      plaidAccountId: a.account_id,
      name: a.name,
      mask: a.mask ?? null,
      type: a.type,
      subtype: a.subtype ?? null,
      currentBalance: plaidToMilliunits(a.balances.current),
      availableBalance: plaidToMilliunits(a.balances.available),
      balanceUpdatedAt: a.balances.last_updated_datetime ?? now,
      createdAt: now,
    }));
    for (let attempt = 0; ; attempt++) {
      const row: repo.BankConnectionRow = {
        id,
        displayId: randomDisplayId(),
        environment: e,
        plaidItemId: exchange.item_id,
        institutionId,
        institutionName: name,
        institutionLogo: logo,
        nickname: name.slice(0, 100),
        status: "connected",
        provider: "Plaid",
        lastSyncedAt: null,
        syncCursor: null,
        lastResetAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const api = toApi(row, accountRows);
      try {
        await db.batch([
          repo.insertConnectionStmt(db, row),
          ...accountRows.map((a) => repo.insertAccountStmt(db, a)),
          changeLogInsert(db, {
            budgetId: null,
            actor,
            action: "create",
            entityType: "bank_connection",
            entityId: id,
            before: null,
            after: api,
          }),
        ]);
        return api;
      } catch (err) {
        const collision =
          err instanceof Error &&
          /display_id/.test(`${err.message} ${String((err as { cause?: unknown }).cause)}`);
        if (!collision) throw err;
        if (attempt >= 4) throw new Conflict("Bank connection");
      }
    }
  } catch (err) {
    await deleteAccessToken(env, id).catch(() => undefined);
    await plaid.post("/item/remove", { access_token: accessToken }).catch(() => undefined);
    throw err;
  }
}

/** A refusal the route answers with its own status and code (409 reset too soon, 502 Plaid failed). */
export class BankConnectionRefused extends Error {
  constructor(
    readonly status: 409 | 502,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "BankConnectionRefused";
  }
}

const MAX_REMOVE_ATTEMPTS = 5;

export const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** When Reset is available again, or null when it is available now. */
export function resetAvailableAt(lastResetAt: string | null, now = Date.now()): string | null {
  if (!lastResetAt) return null;
  const at = Date.parse(lastResetAt) + RESET_INTERVAL_MS;
  return now >= at ? null : new Date(at).toISOString();
}

/** The connection in the plan's environment; another environment's is "not found", like an unknown id. */
async function scoped(env: Env, budgetId: string, id: string) {
  const e = await getBudgetEnvironment(env, budgetId);
  const found = await repo.getInEnvironment(getDb(env), e, id);
  if (!found) throw new NotFound("Bank connection");
  return found;
}

async function linksOf(env: Env, budgetId: string, accounts: repo.BankAccountRow[]) {
  return accountsRepo.linksForPlan(
    getDb(env),
    budgetId,
    accounts.map((a) => a.id),
  );
}

export async function getBankConnection(
  env: Env,
  budgetId: string,
  id: string,
): Promise<BankConnection> {
  const { row, accounts } = await scoped(env, budgetId, id);
  return toApi(row, accounts, await linksOf(env, budgetId, accounts));
}

export async function renameBankConnection(
  env: Env,
  actor: string,
  input: { budget_id: string; id: string; nickname: string },
): Promise<BankConnection> {
  const { row, accounts } = await scoped(env, input.budget_id, input.id);
  const links = await linksOf(env, input.budget_id, accounts);
  const trimmed = input.nickname.trim();
  const nickname = trimmed === "" ? row.institutionName.slice(0, 100) : trimmed;
  const before = toApi(row, accounts, links);
  if (nickname === row.nickname) return before;
  const db = getDb(env);
  const now = new Date().toISOString();
  await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: null,
        actor,
        action: "update",
        entityType: "bank_connection",
        entityId: row.id,
        before,
        after: toApi({ ...row, nickname, updatedAt: now }, accounts, links),
      },
      repo.connectionExists(db, row.id),
    ),
    repo.updateConnectionStmt(db, row.id, { nickname, updatedAt: now }),
  ]);
  return getBankConnection(env, input.budget_id, input.id);
}

/** Update-mode Link token for Reset and Repair. Writes nothing. */
export async function createUpdateLinkToken(env: Env, budgetId: string, id: string) {
  const { row } = await scoped(env, budgetId, id);
  const at = resetAvailableAt(row.lastResetAt);
  if (at) {
    throw new BankConnectionRefused(
      409,
      "reset_too_soon",
      `This bank connection was reset less than 24 hours ago. Reset is available again after ${at}.`,
    );
  }
  const token = await getAccessToken(env, row.id);
  if (!token) {
    throw new BankConnectionRefused(
      409,
      "bank_connection_broken",
      "This bank connection cannot be reset. Remove it and connect the bank again.",
    );
  }
  const plaid = await plaidFor(env, row.environment);
  const res = await plaid.post<{ link_token: string; expiration: string }>(
    "/link/token/create",
    linkTokenUpdateRequest(row.environment, env.PUBLIC_HOSTNAME, token),
  );
  return { link_token: res.link_token, expiration: res.expiration };
}

/** The browser calls this when Link's update mode finished. */
export async function finishReset(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
): Promise<BankConnection> {
  const { row, accounts } = await scoped(env, budgetId, id);
  const links = await linksOf(env, budgetId, accounts);
  const db = getDb(env);
  const now = new Date().toISOString();
  await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: null,
        actor,
        action: "update",
        entityType: "bank_connection",
        entityId: row.id,
        before: toApi(row, accounts, links),
        after: toApi(
          { ...row, status: "connected", lastResetAt: now, updatedAt: now },
          accounts,
          links,
        ),
      },
      repo.connectionExists(db, row.id),
    ),
    repo.updateConnectionStmt(db, row.id, {
      status: "connected",
      lastResetAt: now,
      updatedAt: now,
    }),
  ]);
  return getBankConnection(env, budgetId, id);
}

/**
 * Removes the Item at Plaid, then the connection, its bank accounts and the stored token in one batch.
 * Plaid says the Item is gone (ITEM_NOT_FOUND, INVALID_ACCESS_TOKEN): the local removal completes anyway.
 * Any other Plaid failure (network, 5xx, rate limit): nothing is removed and the owner can try again.
 */
export async function removeBankConnection(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
): Promise<{ deleted: true; plaid: "removed" | "already_removed" }> {
  const { row, accounts } = await scoped(env, budgetId, id);
  let plaid: "removed" | "already_removed" = "already_removed";
  const token = await getAccessToken(env, row.id);
  if (token) {
    const client = await plaidFor(env, row.environment); // PlaidNotSetUp propagates (422)
    try {
      await client.post("/item/remove", { access_token: token });
      plaid = "removed";
    } catch (err) {
      if (!(err instanceof PlaidApiError)) throw err;
      if (!ITEM_GONE_CODES.has(err.errorCode ?? "")) {
        throw new BankConnectionRefused(
          502,
          "plaid_remove_failed",
          "The bank connection could not be removed at Plaid. Nothing was changed. Try again.",
        );
      }
    }
  }
  const db = getDb(env);
  for (let attempt = 0; attempt < MAX_REMOVE_ATTEMPTS; attempt++) {
    // Read the links as late as possible. The deletes hold only while no account outside this read is
    // linked, so a link made since loses the batch (and the next attempt unlinks and logs it).
    const unlink = await unlinkForConnectionStmts(db, actor, row.id);
    const holds = repo.removalHolds(db, row.id, accountsRepo.noOtherLinks(row.id, unlink.ids));
    await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId: null,
          actor,
          action: "delete",
          entityType: "bank_connection",
          entityId: row.id,
          before: toApi(row, accounts, await linksOf(env, budgetId, accounts)),
          after: null,
        },
        holds,
      ),
      ...unlink.stmts,
      repo.deleteAccountsStmt(db, row.id, holds),
      repo.deleteConnectionStmt(db, row.id, holds),
      repo.deleteTokenWhenGoneStmt(db, row.id),
    ]);
    if ((await repo.connectionExists(db, row.id)).length === 0) return { deleted: true, plaid };
  }
  throw new Conflict("Bank connection");
}
