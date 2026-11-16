import type { Month } from "@budget/core/month";
import { applyMove } from "@budget/schema/assigned-edit";
import type { MonthDetail } from "@budget/schema/months";
import {
  type MoveCreate,
  type MoveResult,
  MoveResultResponse,
  READY_TO_ASSIGN,
} from "@budget/schema/moves";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { apiFetch } from "./client";
import { beginWrite, endWrite, inOrder } from "./monthCache";

export const postMove = async (
  budgetId: string,
  month: Month,
  body: MoveCreate,
): Promise<MoveResult> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/months/${month}/moves`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: MoveResultResponse,
    })
  ).data;

export const postCover = async (
  budgetId: string,
  month: Month,
  categoryId: string,
  from: string,
): Promise<MoveResult> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/months/${month}/categories/${categoryId}/cover`, {
      method: "POST",
      body: { from },
      idempotencyKey: crypto.randomUUID(),
      schema: MoveResultResponse,
    })
  ).data;

export type MoveRequest = {
  month: Month;
  from: string;
  to: string;
  amount: number;
  /** Set for a cover: the server moves the category's own overspent amount. */
  cover?: { categoryId: string };
};

const side = (s: string) => (s === READY_TO_ASSIGN ? null : s);

/**
 * Returns move(m): shows the move in every cached month of the plan at once (through monthCache.ts), sends the
 * POST in the plan's write queue, and on failure applies the inverse move and runs onError.
 */
export function useMoveMoney(
  budgetId: string,
  onError: (e: unknown) => void,
): (m: MoveRequest) => Promise<void> {
  const qc = useQueryClient();
  return useCallback(
    async (m) => {
      const apply = (from: string, to: string) =>
        qc.setQueriesData<MonthDetail>(
          { queryKey: ["month", budgetId] },
          (d) => d && applyMove(d, m.month, side(from), side(to), m.amount),
        );
      await beginWrite(qc, budgetId);
      apply(m.from, m.to);
      try {
        await inOrder(budgetId, () =>
          m.cover
            ? postCover(budgetId, m.month, m.cover.categoryId, m.from)
            : postMove(budgetId, m.month, { from: m.from, to: m.to, amount: m.amount }),
        );
      } catch (e) {
        apply(m.to, m.from);
        onError(e);
      } finally {
        endWrite(qc, budgetId);
      }
    },
    [qc, budgetId, onError],
  );
}
