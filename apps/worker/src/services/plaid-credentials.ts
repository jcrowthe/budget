import type { PlaidCredentialsPut } from "@budget/schema/plaid-credentials";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { plaidCredentialStatus, storePlaidCredentials } from "../plaid/credentials";

/** The change_log row holds only the environment and the time: never a value. */
export async function putPlaidCredentials(env: Env, actor: string, input: PlaidCredentialsPut) {
  const before = await plaidCredentialStatus(env, input.environment);
  const set_at = await storePlaidCredentials(env, input.environment, {
    client_id: input.client_id,
    secret: input.secret,
  });
  await changeLogInsert(getDb(env), {
    budgetId: null,
    actor,
    action: before.configured ? "update" : "create",
    entityType: "plaid_credentials",
    entityId: input.environment,
    before: before.configured ? { environment: before.environment, set_at: before.set_at } : null,
    after: { environment: input.environment, set_at },
  });
  return { environment: input.environment, configured: true, set_at };
}

export async function listPlaidCredentials(env: Env) {
  return [
    await plaidCredentialStatus(env, "sandbox"),
    await plaidCredentialStatus(env, "production"),
  ];
}
