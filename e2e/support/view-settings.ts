import type { APIRequestContext } from "@playwright/test";
import { call } from "./register-seed";

/** Sets view settings through the API. `scope` is an account id, or "all" for All Accounts. */
export async function setViewSettings(
  request: APIRequestContext,
  plan: string,
  scope: string,
  patch: Record<string, unknown>,
) {
  const path =
    scope === "all"
      ? `/api/v1/budgets/${plan}/view_settings/all_accounts`
      : `/api/v1/budgets/${plan}/accounts/${scope}/view_settings`;
  return (await call(request, "PUT", path, patch)).view_settings;
}

export const viewSettingsOf = async (request: APIRequestContext, plan: string, scope: string) =>
  (
    await call(
      request,
      "GET",
      scope === "all"
        ? `/api/v1/budgets/${plan}/view_settings/all_accounts`
        : `/api/v1/budgets/${plan}/accounts/${scope}/view_settings`,
    )
  ).view_settings;
