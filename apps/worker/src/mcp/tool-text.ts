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
