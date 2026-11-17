import { planSyncDue } from "@budget/schema/bank-link";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAccounts } from "../api/accounts";
import { checkedPlans as checked, startPlanSync } from "../api/bank-link";

/**
 * When a plan opens (once per page load and plan) and a linked account was never synced or last synced six
 * hours ago or more, sends one plan sync in the background. It reads the sidebar's own accounts query.
 * The id is noted before the decision, so the sync after adding or linking (the plan is already checked)
 * and a later refetch never double up.
 */
export function usePlanOpenSync(planId: string | undefined): void {
  const qc = useQueryClient();
  const accounts = useAccounts(planId);
  const ready = accounts.isSuccess;
  // biome-ignore lint/correctness/useExhaustiveDependencies: decided once per plan, when its accounts first load
  useEffect(() => {
    if (!planId || !ready || checked.has(planId)) return;
    checked.add(planId);
    if (accounts.data && planSyncDue(accounts.data, Date.now())) startPlanSync(qc, planId);
  }, [planId, ready]);
}
