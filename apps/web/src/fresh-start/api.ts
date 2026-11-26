import { FreshStartResponse } from "@budget/schema/fresh-start";
import { apiFetch } from "../api/client";

/** POST /budgets/{id}/fresh-start. Not undoable, so no change set is registered. */
export const freshStart = async (
  budgetId: string,
  body: { name: string; stop_importing_in_archive: boolean; today: string },
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/fresh-start`, {
      method: "POST",
      body,
      schema: FreshStartResponse,
    })
  ).data;
