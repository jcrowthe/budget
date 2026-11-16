import type { Account } from "@budget/schema/accounts";
import { RegisterTable } from "./RegisterTable";
import { RegisterToolbar } from "./RegisterToolbar";
import "./register.css";

/** One account's register, or (without `account`) every account's: All Accounts. */
export function Register({ budgetId, account }: { budgetId: string; account?: Account }) {
  return (
    <section className="register" aria-label="Register">
      <RegisterToolbar name={account?.name ?? "All Accounts"} />
      <RegisterTable budgetId={budgetId} account={account} />
    </section>
  );
}
