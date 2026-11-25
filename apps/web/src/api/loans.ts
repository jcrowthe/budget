import type { Month } from "@budget/core/month";
import type { CardPaymentRequest as CardPaymentRequestSchema } from "@budget/schema/card-payments";
import { CardPaymentResponse } from "@budget/schema/card-payments";
import { LoanActivityResponse } from "@budget/schema/loan-activity";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { recordChange } from "../undo/store";
import { apiFetch } from "./client";
import { keepPreviousInPlan } from "./placeholder";

type CardPaymentRequest = z.input<typeof CardPaymentRequestSchema>;

const url = (budgetId: string, loanId: string) =>
  `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(loanId)}` as const;

export const getLoanActivity = async (budgetId: string, loanId: string, month: Month) =>
  (
    await apiFetch(`${url(budgetId, loanId)}/activity?month=${month}`, {
      schema: LoanActivityResponse,
    })
  ).data;

/** One loan's Account Activity for a month. Keyed by plan so a plan's invalidation reaches it. */
export const useLoanActivity = (budgetId: string, loanId: string, month: Month) =>
  useQuery({
    queryKey: ["loan-activity", budgetId, loanId, month],
    queryFn: () => getLoanActivity(budgetId, loanId, month),
    placeholderData: keepPreviousInPlan<Awaited<ReturnType<typeof getLoanActivity>>>(budgetId),
  });

export const recordLoanPayment = async (
  budgetId: string,
  loanId: string,
  input: CardPaymentRequest,
) =>
  (
    await apiFetch(`${url(budgetId, loanId)}/payments`, {
      method: "POST",
      body: input,
      idempotencyKey: crypto.randomUUID(),
      onChangeSet: (id) => recordChange(budgetId, id, "register"),
      schema: CardPaymentResponse,
    })
  ).data;

/** On success every query of the plan (accounts, summary, loan activity, months, transactions, reports) refetches. */
export function useRecordLoanPayment(budgetId: string, loanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CardPaymentRequest) => recordLoanPayment(budgetId, loanId, input),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) }),
  });
}
