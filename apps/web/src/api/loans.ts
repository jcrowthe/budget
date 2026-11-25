import type { Month } from "@budget/core/month";
import type { CardPaymentRequest as CardPaymentRequestSchema } from "@budget/schema/card-payments";
import { CardPaymentResponse } from "@budget/schema/card-payments";
import { LoanActivityResponse } from "@budget/schema/loan-activity";
import {
  type LoanBalanceUpdateRequest,
  LoanBalanceUpdateResponse,
} from "@budget/schema/loan-balance-update";
import { LoanPairingResponse, LoanSummaryResponse } from "@budget/schema/loan-summary";
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

export const getLoanSummary = async (budgetId: string, loanId: string, month: Month) =>
  (
    await apiFetch(`${url(budgetId, loanId)}/summary?month=${month}`, {
      schema: LoanSummaryResponse,
    })
  ).data;

/** One loan's summary (tiles, payoff, chart series, paired category). Keyed by plan so a plan's invalidation reaches it. */
export const useLoanSummary = (budgetId: string, loanId: string, month: Month) =>
  useQuery({
    queryKey: ["loan-summary", budgetId, loanId, month],
    queryFn: () => getLoanSummary(budgetId, loanId, month),
    placeholderData: keepPreviousInPlan<Awaited<ReturnType<typeof getLoanSummary>>>(budgetId),
  });

export const pairLoanCategory = async (budgetId: string, loanId: string, categoryId: string) =>
  (
    await apiFetch(`${url(budgetId, loanId)}/paired-category`, {
      method: "PUT",
      body: { category_id: categoryId },
      idempotencyKey: crypto.randomUUID(),
      onChangeSet: (id) => recordChange(budgetId, id, "register"),
      schema: LoanPairingResponse,
    })
  ).data.account;

/** On success every query of the plan refetches (the account, the summary, Record Payment's categorizing). */
export function usePairLoanCategory(budgetId: string, loanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => pairLoanCategory(budgetId, loanId, categoryId),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) }),
  });
}

/** The Update Balance write: one change set (undo restores the lines, the adjustment and the terms). */
export const updateLoanBalance = async (
  budgetId: string,
  loanId: string,
  input: LoanBalanceUpdateRequest,
) =>
  (
    await apiFetch(`${url(budgetId, loanId)}/balance-update`, {
      method: "POST",
      body: input,
      idempotencyKey: crypto.randomUUID(),
      onChangeSet: (id) => recordChange(budgetId, id, "register"),
      schema: LoanBalanceUpdateResponse,
    })
  ).data;

/** The same answer with nothing written: no change set to record, no query to invalidate. */
export const previewLoanBalance = async (
  budgetId: string,
  loanId: string,
  input: LoanBalanceUpdateRequest,
) =>
  (
    await apiFetch(`${url(budgetId, loanId)}/balance-update`, {
      method: "POST",
      body: { ...input, preview: true },
      idempotencyKey: crypto.randomUUID(),
      schema: LoanBalanceUpdateResponse,
    })
  ).data;

/** On success every query of the plan (header balances, summary, activity, plan months) refetches. */
export function useUpdateLoanBalance(budgetId: string, loanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoanBalanceUpdateRequest) => updateLoanBalance(budgetId, loanId, input),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) }),
  });
}
