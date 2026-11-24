import { z } from "@hono/zod-openapi";

/** How a payee's category is suggested: from its history, a fixed choice, or not at all. */
export const PAYEE_CATEGORY_MODES = ["history", "fixed", "off"] as const;
export const CategoryMode = z.enum(PAYEE_CATEGORY_MODES).openapi("PayeeCategoryMode");
export type CategoryMode = z.infer<typeof CategoryMode>;

/**
 * The recency order of a payee's counted rows: the ONE constant that the SQL (`recencyOrderSql` in the worker) and
 * `compareRecency` are both built from. Same-date rows go in the order they were entered (`created_at` ascending).
 */
export const RECENCY_ORDER = [
  { column: "date", dir: "desc" },
  { column: "created_at", dir: "asc" },
  { column: "id", dir: "asc" },
] as const;

/** What a row remembers: a category, or Ready to Assign (`{ null, true }`). Never a sentinel id. */
export type CategoryValue = { category_id: string | null; inflow_to_ready_to_assign: boolean };

export const sameValue = (a: CategoryValue, b: CategoryValue): boolean =>
  a.category_id === b.category_id && a.inflow_to_ready_to_assign === b.inflow_to_ready_to_assign;

type Recency = { date: string; created_at: string; id: string };

export function compareRecency(a: Recency, b: Recency): number {
  for (const { column, dir } of RECENCY_ORDER) {
    const x = a[column];
    const y = b[column];
    if (x === y) continue;
    return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
  }
  return 0;
}

/**
 * The history rule. `current` is the stored default when it is still live (else null); `last3` the values of the
 * payee's first 3 counted rows in recency order.
 * 1. One value holds at least 2 of the last 3: that value.
 * 2. Else a live current default is kept.
 * 3. Else the first of the last 3, or null.
 */
export function nextDefault(
  current: CategoryValue | null,
  last3: readonly CategoryValue[],
): CategoryValue | null {
  for (const v of last3) {
    if (last3.filter((w) => sameValue(v, w)).length >= 2) return v;
  }
  return current ?? last3[0] ?? null;
}

/**
 * The suggestion the API shows. `fixed` and `stored` are already live-filtered, and `stored` has already
 * fallen back to the read-time rule.
 */
export function effectiveDefault(
  mode: CategoryMode,
  fixed: CategoryValue | null,
  stored: CategoryValue | null,
): CategoryValue | null {
  if (mode === "off") return null;
  return mode === "fixed" ? fixed : stored;
}
