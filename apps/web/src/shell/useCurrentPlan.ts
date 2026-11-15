import { useEffect } from "react";
import { useParams } from "react-router";
import { useBudgets } from "../api/budgets";

export const LAST_PLAN_KEY = "budget.lastPlanId";

/** Reads :budgetId, remembers it as the last used plan, and resolves it against the plan list. */
export function useCurrentPlan() {
  const { budgetId } = useParams();
  const budgets = useBudgets();
  const plan = budgets.data?.find((b) => b.id === budgetId);
  useEffect(() => {
    if (plan) localStorage.setItem(LAST_PLAN_KEY, plan.id);
  }, [plan]);
  return { budgetId, plan, plans: budgets.data ?? [], isLoading: budgets.isLoading };
}

/** Sets the title to "<Page> | <Plan> | Budget". */
export function usePageTitle(page: string) {
  const { plan } = useCurrentPlan();
  useEffect(() => {
    document.title = plan ? `${page} | ${plan.name} | Budget` : "Budget";
  }, [page, plan]);
}
