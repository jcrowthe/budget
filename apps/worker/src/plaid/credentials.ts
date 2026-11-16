import type { BankEnvironment } from "@budget/schema/budgets";
import type { Env } from "../env";
import { getSecret, SecretsUnavailable, setSecret } from "../secrets";

/** The only reader of Plaid credentials. They live encrypted in D1 (`secrets`), never in Worker variables. */
export const credentialSecretName = (e: BankEnvironment) => `plaid_credentials:${e}`;

export class PlaidNotSetUp extends Error {
  constructor() {
    super("Bank connections are not set up");
    this.name = "PlaidNotSetUp";
  }
}

export interface PlaidCredentials {
  client_id: string;
  secret: string;
  set_at: string;
}

function parse(raw: string | null): PlaidCredentials | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PlaidCredentials>;
    if (typeof v.client_id !== "string" || typeof v.secret !== "string") return null;
    return { client_id: v.client_id, secret: v.secret, set_at: String(v.set_at ?? "") };
  } catch {
    return null;
  }
}

export async function storePlaidCredentials(
  env: Env,
  e: BankEnvironment,
  creds: { client_id: string; secret: string },
): Promise<string> {
  const set_at = new Date().toISOString();
  await setSecret(env, credentialSecretName(e), JSON.stringify({ ...creds, set_at }));
  return set_at;
}

/** Only whether credentials are set and when: never a value or any part of one. */
export async function plaidCredentialStatus(env: Env, e: BankEnvironment) {
  const creds = parse(await getSecret(env, credentialSecretName(e)));
  return { environment: e, configured: creds !== null, set_at: creds?.set_at || null };
}

export async function loadPlaidCredentials(
  env: Env,
  e: BankEnvironment,
): Promise<PlaidCredentials> {
  // Locally and in tests only Sandbox is reachable.
  if (e === "production" && env.ENVIRONMENT !== "production") throw new PlaidNotSetUp();
  try {
    const creds = parse(await getSecret(env, credentialSecretName(e)));
    if (!creds) throw new PlaidNotSetUp();
    return creds;
  } catch (err) {
    if (err instanceof SecretsUnavailable) throw new PlaidNotSetUp();
    throw err;
  }
}
