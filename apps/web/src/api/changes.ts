import { type UndoResult, UndoResultResponse } from "@budget/schema/changes";
import { apiFetch } from "./client";

/** Undoes one change set on the server (docs/undo-design.md, "Undo engine and store"). */
export const undoChangeSet = async (budgetId: string, changeSetId: string): Promise<UndoResult> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/changes/${changeSetId}/undo`, {
      method: "POST",
      schema: UndoResultResponse,
    })
  ).data;
