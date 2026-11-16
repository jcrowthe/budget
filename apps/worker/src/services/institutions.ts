import type { Institution } from "@budget/schema/institutions";
import type { Env } from "../env";
import { plaidFor } from "../plaid/client";
import { type PlaidInstitution, POPULAR_INSTITUTIONS, toInstitution } from "../plaid/institutions";
import { getBudgetEnvironment } from "./budgets";

export async function searchInstitutions(
  env: Env,
  budgetId: string,
  query: string,
): Promise<Institution[]> {
  const plaid = await plaidFor(env, await getBudgetEnvironment(env, budgetId));
  const res = await plaid.post<{ institutions: PlaidInstitution[] }>("/institutions/search", {
    query,
    products: ["transactions"],
    country_codes: ["US"],
    options: { include_optional_metadata: true },
  });
  return res.institutions.slice(0, 10).map(toInstitution);
}

export async function popularInstitutions(env: Env, budgetId: string): Promise<Institution[]> {
  const e = await getBudgetEnvironment(env, budgetId);
  const plaid = await plaidFor(env, e);
  const results = await Promise.allSettled(
    POPULAR_INSTITUTIONS[e].map((institution_id) =>
      plaid.post<{ institution: PlaidInstitution }>("/institutions/get_by_id", {
        institution_id,
        country_codes: ["US"],
        options: { include_optional_metadata: true },
      }),
    ),
  );
  const ok = results.flatMap((r) =>
    r.status === "fulfilled" ? [toInstitution(r.value.institution)] : [],
  );
  if (ok.length === 0) {
    const first = results.find((r) => r.status === "rejected");
    if (first) throw first.reason;
  }
  return ok;
}
