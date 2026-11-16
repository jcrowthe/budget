import type { Budget } from "@budget/schema/budgets";
import { useEffect } from "react";
import { useParams } from "react-router";
import { useBudgets } from "../api/budgets";

/** Reads :budgetId and resolves it against the plan list. */
export function useCurrentPlan() {
  const { budgetId } = useParams();
  const budgets = useBudgets();
  const plan = budgets.data?.find((b) => b.id === budgetId);
  return {
    budgetId,
    plan,
    plans: budgets.data ?? [],
    isLoading: budgets.isLoading,
    error: budgets.error,
  };
}

/** The plan opened most recently (server's last_opened_at); the first plan when none was ever opened. */
export function pickLastOpened(plans: Budget[]): Budget | undefined {
  let best: Budget | undefined;
  for (const p of plans) {
    if (p.last_opened_at && (!best?.last_opened_at || p.last_opened_at > best.last_opened_at))
      best = p;
  }
  return best ?? plans[0];
}

/** Other plans, most recently opened first (never opened last; ties keep list order); at most n. */
export function recentOtherPlans(plans: Budget[], currentId: string | undefined, n = 5): Budget[] {
  return plans
    .filter((p) => p.id !== currentId)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const x = a.p.last_opened_at;
      const y = b.p.last_opened_at;
      if (x && y) return x < y ? 1 : x > y ? -1 : a.i - b.i;
      if (x) return -1;
      if (y) return 1;
      return a.i - b.i;
    })
    .slice(0, n)
    .map((o) => o.p);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** Sets the title to "<Page> | <Plan> | Budget". */
export function usePageTitle(page: string) {
  const { plan } = useCurrentPlan();
  useDocumentTitle(plan ? `${page} | ${plan.name} | Budget` : "Budget");
}
