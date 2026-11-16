import { useParams } from "react-router";
import { AllAccountsHeader } from "../account/AccountHeader";
import { Register } from "../register/Register";
import { usePageTitle } from "../shell/useCurrentPlan";

function AccountsPage() {
  const { budgetId = "" } = useParams();
  usePageTitle("All Accounts");
  return (
    <>
      <AllAccountsHeader budgetId={budgetId} />
      <Register budgetId={budgetId} />
    </>
  );
}

export const page = { path: "/:budgetId/accounts", element: <AccountsPage /> };
