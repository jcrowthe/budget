import { useState } from "react";
import { NavLink } from "react-router";
import { AddAccountDialog } from "./AddAccountDialog";
import { AccountsIcon, CaretIcon, Logo, PlanIcon, PlusCircleIcon, ReflectIcon } from "./icons";
import { NewPlanDialog } from "./NewPlanDialog";
import { PlanMenu } from "./PlanMenu";
import { LAST_PLAN_KEY, useCurrentPlan } from "./useCurrentPlan";

export function Sidebar() {
  const { budgetId, plan, plans } = useCurrentPlan();
  const [menu, setMenu] = useState(false);
  const [newPlan, setNewPlan] = useState(false);
  const [addAccount, setAddAccount] = useState(false);
  // Without a plan in the URL, links point at the last used plan, else the first.
  const target = budgetId ?? localStorage.getItem(LAST_PLAN_KEY) ?? plans[0]?.id;
  const to = (page: string) => (target ? `/${target}/${page}` : "/");

  return (
    <nav className="sidebar" aria-label="Sidebar">
      <button
        type="button"
        className="plan-button"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
      >
        <Logo className="logo" />
        <span className="name">{plan?.name ?? "Budget"}</span>
        <CaretIcon />
      </button>
      {menu ? (
        <PlanMenu
          onClose={() => setMenu(false)}
          onNewPlan={() => {
            setMenu(false);
            setNewPlan(true);
          }}
        />
      ) : null}
      <div className="nav">
        <NavLink to={to("budget")}>
          <PlanIcon />
          Plan
        </NavLink>
        <NavLink to={to("reflect")}>
          <ReflectIcon />
          Reflect
        </NavLink>
        <NavLink to={to("accounts")}>
          <AccountsIcon />
          All Accounts
        </NavLink>
      </div>
      <div className="accounts-card">
        <h5>No Accounts</h5>
        <p>You can't plan without adding accounts first. How about adding one now?</p>
      </div>
      <button type="button" className="add-account" onClick={() => setAddAccount(true)}>
        <PlusCircleIcon />
        Add Account
      </button>
      {newPlan ? <NewPlanDialog onClose={() => setNewPlan(false)} /> : null}
      {addAccount ? <AddAccountDialog onClose={() => setAddAccount(false)} /> : null}
    </nav>
  );
}
