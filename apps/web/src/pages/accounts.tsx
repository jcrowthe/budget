import { useParams } from "react-router";
import { AllAccountsHeader } from "../account/AccountHeader";
import { useEnterDueOnOpen } from "../api/scheduledTransactions";
import { Register } from "../register/Register";
import { SelectionProvider } from "../register/selection";
import { usePageTitle } from "../shell/useCurrentPlan";

function AccountsPage() {
  const { budgetId = "" } = useParams();
  usePageTitle("All Accounts");
  useEnterDueOnOpen(budgetId);
  return (
    <SelectionProvider key={`${budgetId}:all`}>
      <AllAccountsHeader budgetId={budgetId} />
      <Register budgetId={budgetId} />
    </SelectionProvider>
  );
}

export const page = { path: "/:budgetId/accounts", element: <AccountsPage /> };
