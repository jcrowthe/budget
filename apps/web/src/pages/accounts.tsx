import { attentionTotal } from "@budget/schema/attention";
import { useParams } from "react-router";
import { AllAccountsHeader } from "../account/AccountHeader";
import { useEnterDueOnOpen } from "../api/scheduledTransactions";
import { AttentionBanner } from "../register/AttentionBanner";
import { AttentionFilterProvider } from "../register/attention-filter";
import { useOpenAccounts } from "../register/openAccounts";
import { Register } from "../register/Register";
import { SelectionProvider } from "../register/selection";
import { usePageTitle } from "../shell/useCurrentPlan";

function AccountsPage() {
  const { budgetId = "" } = useParams();
  usePageTitle("All Accounts");
  useEnterDueOnOpen(budgetId);
  const { openAccounts, loaded } = useOpenAccounts(budgetId);
  return (
    <SelectionProvider key={`${budgetId}:all`}>
      <AttentionFilterProvider>
        {loaded && <AttentionBanner count={attentionTotal(openAccounts)} />}
        <AllAccountsHeader budgetId={budgetId} />
        <Register budgetId={budgetId} />
      </AttentionFilterProvider>
    </SelectionProvider>
  );
}

export const page = { path: "/:budgetId/accounts", element: <AccountsPage /> };
