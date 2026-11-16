import {
  type BankConnection,
  BankConnectionListResponse,
  BankConnectionResponse,
  LinkTokenResponse,
} from "@budget/schema/bank-connections";
import { InstitutionListResponse } from "@budget/schema/institutions";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { keepPreviousInPlan } from "./placeholder";

const q = (budgetId: string) => `budget_id=${encodeURIComponent(budgetId)}`;

export const fetchPopular = async (budgetId: string) =>
  (
    await apiFetch(`/api/v1/institutions/popular?${q(budgetId)}`, {
      schema: InstitutionListResponse,
    })
  ).data.institutions;

export const searchInstitutions = async (budgetId: string, query: string) =>
  (
    await apiFetch(`/api/v1/institutions?${q(budgetId)}&query=${encodeURIComponent(query)}`, {
      schema: InstitutionListResponse,
    })
  ).data.institutions;

/** No Idempotency-Key: the middleware stores response bodies and the link token must not be stored. */
export const createLinkToken = async (budgetId: string) =>
  (
    await apiFetch("/api/v1/bank-connections/link-token", {
      method: "POST",
      body: { budget_id: budgetId },
      schema: LinkTokenResponse,
    })
  ).data;

export const createBankConnection = async (input: {
  budget_id: string;
  public_token: string;
  institution_id: string;
  institution_name?: string;
}): Promise<BankConnection> =>
  (
    await apiFetch("/api/v1/bank-connections", {
      method: "POST",
      body: input,
      idempotencyKey: crypto.randomUUID(),
      schema: BankConnectionResponse,
    })
  ).data.bank_connection;

export const listBankConnections = async (budgetId: string) =>
  (
    await apiFetch(`/api/v1/bank-connections?${q(budgetId)}`, {
      schema: BankConnectionListResponse,
    })
  ).data.bank_connections;

export const usePopularInstitutions = (budgetId: string) =>
  useQuery({
    queryKey: ["institutions", "popular", budgetId],
    queryFn: () => fetchPopular(budgetId),
    enabled: !!budgetId,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

export const useInstitutionSearch = (budgetId: string, query: string) =>
  useQuery({
    queryKey: ["institutions", "search", budgetId, query],
    queryFn: () => searchInstitutions(budgetId, query),
    enabled: !!budgetId && query !== "",
    placeholderData: keepPreviousInPlan(budgetId),
    retry: false,
  });
