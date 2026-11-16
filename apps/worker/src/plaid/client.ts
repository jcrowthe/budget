import type { BankEnvironment } from "@budget/schema/budgets";
import type { Env } from "../env";
import { loadPlaidCredentials } from "./credentials";

export const PLAID_BASE: Record<BankEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

/** Message holds only the Plaid error code or status: never request data. */
export class PlaidApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
    readonly displayMessage: string | null,
  ) {
    super(`Plaid ${errorCode ?? status}`);
    this.name = "PlaidApiError";
  }
}

export interface PlaidClient {
  environment: BankEnvironment;
  post<T>(path: string, body: Record<string, unknown>): Promise<T>;
}

export async function plaidFor(env: Env, e: BankEnvironment): Promise<PlaidClient> {
  const creds = await loadPlaidCredentials(env, e);
  return {
    environment: e,
    async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
      let res: Response;
      try {
        res = await fetch(PLAID_BASE[e] + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "PLAID-CLIENT-ID": creds.client_id,
            "PLAID-SECRET": creds.secret,
            "Plaid-Version": "2020-09-14",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new PlaidApiError(0, null, null);
      }
      if (!res.ok) {
        let code: string | null = null;
        let display: string | null = null;
        try {
          const j = (await res.json()) as { error_code?: unknown; display_message?: unknown };
          code = typeof j.error_code === "string" ? j.error_code : null;
          display = typeof j.display_message === "string" ? j.display_message : null;
        } catch {
          // not JSON
        }
        throw new PlaidApiError(res.status, code, display);
      }
      return (await res.json()) as T;
    },
  };
}

/** Pure, for tests. No webhook, ever. `redirect_uri` only for production (OAuth banks). */
export function linkTokenRequest(e: BankEnvironment, publicHostname: string) {
  return {
    client_name: "Budget",
    language: "en",
    country_codes: ["US"],
    products: ["transactions"],
    transactions: { days_requested: 730 },
    user: { client_user_id: "budget-owner" },
    ...(e === "production" ? { redirect_uri: `https://${publicHostname}/plaid/oauth` } : {}),
  };
}
