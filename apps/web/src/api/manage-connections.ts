import {
  type BankConnection,
  BankConnectionDeleted,
  BankConnectionResponse,
  LinkTokenResponse,
} from "@budget/schema/bank-connections";
import type { QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

const url = (id: string, budgetId: string, tail = ""): `/api/v1/${string}` =>
  `/api/v1/bank-connections/${encodeURIComponent(id)}${tail}?budget_id=${encodeURIComponent(budgetId)}`;

export const renameBankConnection = async (
  budgetId: string,
  id: string,
  nickname: string,
): Promise<BankConnection> =>
  (
    await apiFetch(url(id, budgetId), {
      method: "PATCH",
      body: { nickname },
      idempotencyKey: crypto.randomUUID(),
      schema: BankConnectionResponse,
    })
  ).data.bank_connection;

export const removeBankConnection = async (budgetId: string, id: string) =>
  (
    await apiFetch(url(id, budgetId), {
      method: "DELETE",
      idempotencyKey: crypto.randomUUID(),
      schema: BankConnectionDeleted,
    })
  ).data;

/** The update-mode sign-in token. No Idempotency-Key: the token must not be stored by the middleware. */
export const createUpdateLinkToken = async (budgetId: string, id: string) =>
  (
    await apiFetch(url(id, budgetId, "/link-token"), {
      method: "POST",
      schema: LinkTokenResponse,
    })
  ).data;

export const finishReset = async (budgetId: string, id: string): Promise<BankConnection> =>
  (
    await apiFetch(url(id, budgetId, "/reset"), {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      schema: BankConnectionResponse,
    })
  ).data.bank_connection;

/** Replaces the row in the plan's connection list (the one read the screens hold). */
export function setConnectionInCache(qc: QueryClient, budgetId: string, c: BankConnection): void {
  qc.setQueryData<BankConnection[]>(["bank-connections", budgetId], (old) =>
    old ? old.map((x) => (x.id === c.id ? c : x)) : old,
  );
}
