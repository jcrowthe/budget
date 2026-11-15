import { Navigate, useParams } from "react-router";
import { accountsPath } from "../shell/planPaths";

// The source silently replaces an unknown account id with All Accounts (measured live, EXF-475 polish P1).
// No accounts exist yet, so every id is unknown; EXF-481 renders the register for a known id.
function AccountPage() {
  const { budgetId = "" } = useParams();
  return <Navigate replace to={accountsPath(budgetId)} />;
}

export const page = { path: "/:budgetId/accounts/:accountId", element: <AccountPage /> };
