import type { Month } from "@budget/core/month";
import { monthKey } from "@budget/core/month";
import { useNavigate, useParams } from "react-router";

export const planPath = (budgetId: string, month?: Month) =>
  month ? `/${budgetId}/budget/${monthKey(month)}` : `/${budgetId}/budget`;
export const accountsPath = (budgetId: string) => `/${budgetId}/accounts`;
export const accountPath = (budgetId: string, accountId: string) =>
  `/${budgetId}/accounts/${accountId}`;
export const reflectPath = (budgetId: string, report?: string) =>
  report ? `/${budgetId}/reflect/${report}` : `/${budgetId}/reflect`;

/** "202611" -> "2026-11-01"; anything else (bad year, month 13, extra characters) -> null. */
export function parseMonthParam(p: string | undefined): Month | null {
  const m = p ? /^((?:19|20)\d{2})(0[1-9]|1[0-2])$/.exec(p) : null;
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** The user's LOCAL current month (the source shows the same), not the Worker's UTC month. */
export function localCurrentMonth(now: Date = new Date()): Month {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

// The last month viewed per plan, for this page session only (a reload resets it, as in the source).
const viewed = new Map<string, Month>();
export const rememberMonth = (budgetId: string, month: Month) => void viewed.set(budgetId, month);
export const lastMonth = (budgetId: string): Month | undefined => viewed.get(budgetId);

/** The month in the URL, and a setter that PUSHES a history entry (EXF-493's arrows use it). */
export function usePlanMonth() {
  const { budgetId = "", month } = useParams();
  const navigate = useNavigate();
  return {
    budgetId,
    month: parseMonthParam(month),
    setMonth: (m: Month) => navigate(planPath(budgetId, m)),
  };
}
