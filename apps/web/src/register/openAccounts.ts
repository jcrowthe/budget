import { sidebarSections } from "@budget/core/account-types";
import type { Account } from "@budget/schema/accounts";
import { useMemo } from "react";
import { useAccounts } from "../api/accounts";

/** The plan's open accounts in the sidebar's order, and whether they have loaded. */
export function useOpenAccounts(budgetId: string): { openAccounts: Account[]; loaded: boolean } {
  const q = useAccounts(budgetId);
  const openAccounts = useMemo(
    () =>
      sidebarSections(q.data ?? [])
        .filter((s) => s.name !== "starred" && s.name !== "closed")
        .flatMap((s) => s.rows),
    [q.data],
  );
  return { openAccounts, loaded: q.data !== undefined };
}
