import { z } from "zod";

/** Every id input of every tool: a non-empty string the service resolves (unknown ids are tool errors). */
export const Id = z.string().min(1);

export const MONEY =
  "Amounts are integer milliunits (1000 = one currency unit); negative is an outflow, positive an inflow.";
export const MONTH = "A month is its first day, YYYY-MM-01.";
export const DATE = "Dates are YYYY-MM-DD.";

export const TIMESTAMP = "are ISO 8601 date-times in UTC, for example 2026-11-16T03:29:04.488Z";

/** "Timestamps (a, b) are ISO 8601 …." plus " Timestamps that can be null: b." when `nullable` is non-empty. */
export function timestamps(fields: string[], nullable: string[] = []): string {
  for (const n of nullable) {
    if (!fields.includes(n)) throw new Error(`nullable timestamp ${n} is not among the fields`);
  }
  const base = `Timestamps (${fields.join(", ")}) ${TIMESTAMP}.`;
  return nullable.length === 0
    ? base
    : `${base} Timestamps that can be null: ${nullable.join(", ")}.`;
}

/** "Dates (a, b) are YYYY-MM-DD." */
export function dates(...fields: string[]): string {
  return `Dates (${fields.join(", ")}) are YYYY-MM-DD.`;
}

/** Describes the two fields every account read carries from its bank connection (EXF-461). */
export const LINK_STATE =
  "connection_status (connected, delayed, login_required or broken; null when not linked), connection_reason (the connection's status_reason: unavailable, unsupported or reauthorize; null otherwise and when not linked), last_synced_at (when its bank connection last synced; null when not linked or never synced) and link_missing_since (when the bank stopped listing this account's bank account, ISO 8601 UTC; null when it is listed or the account is not linked). A set link_missing_since is Account Not Found: imports to the account have stopped, and the owner relinks it with Link Account (which replaces this link) or unlinks it; when connection_status is login_required or broken, that is shown first)";
