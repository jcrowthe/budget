import type { Account } from "@budget/schema/accounts";
import { RegisterTable } from "./RegisterTable";
import { RegisterToolbar } from "./RegisterToolbar";
import "./register.css";

export function Register({ account }: { account: Account }) {
  return (
    <section className="register" aria-label="Register">
      <RegisterToolbar name={account.name} />
      <RegisterTable account={account} />
    </section>
  );
}
