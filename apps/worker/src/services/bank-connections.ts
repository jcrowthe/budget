import type { BankConnection, BankConnectionCreate } from "@budget/schema/bank-connections";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { Conflict } from "../middleware/errors";
import { plaidToMilliunits } from "../plaid/amounts";
import { linkTokenRequest, plaidFor } from "../plaid/client";
import type { PlaidInstitution } from "../plaid/institutions";
import { deleteAccessToken, storeAccessToken } from "../plaid/tokens";
import * as repo from "../repositories/bank-connections";
import { getBudgetEnvironment } from "./budgets";

export function toApi(
  row: repo.BankConnectionRow,
  accounts: repo.BankAccountRow[],
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
    })),
  };
}

export async function listBankConnections(env: Env, budgetId: string): Promise<BankConnection[]> {
  const e = await getBudgetEnvironment(env, budgetId);
  return (await repo.listByEnvironment(getDb(env), e)).map((r) => toApi(r.row, r.accounts));
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
