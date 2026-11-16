import { useState } from "react";
import { NavLink, useMatch, useSearchParams } from "react-router";
import { useAccounts } from "../api/accounts";
import { AddAccountDialog } from "./AddAccountDialog";
import { AccountsIcon, CaretIcon, Logo, PlanIcon, PlusCircleIcon, ReflectIcon } from "./icons";
import { NewPlanDialog } from "./NewPlanDialog";
import { PlanMenu } from "./PlanMenu";
import {
  accountsPath,
  lastMonth,
  localCurrentMonth,
  parseMonthParam,
  planPath,
  reflectPath,
} from "./planPaths";
import { SidebarAccounts } from "./SidebarAccounts";
import { pickLastOpened, useCurrentPlan } from "./useCurrentPlan";

export function Sidebar() {
  const { budgetId, plan, plans, isLoading } = useCurrentPlan();
  const monthMatch = useMatch("/:budgetId/budget/:month");
  const onPlan = !!useMatch("/:budgetId/budget/*");
  const [menu, setMenu] = useState(false);
  const [newPlan, setNewPlan] = useState(false);
  const [addAccount, setAddAccount] = useState(false);
  // Until Manage Bank Connections exists (EXF-460), ?add-accounts=connections opens the connections variant.
  const [params, setParams] = useSearchParams();
  const connectionsVariant = params.get("add-accounts") === "connections";
  const clearConnections = () => {
    const next = new URLSearchParams(params);
    next.delete("add-accounts");
    setParams(next, { replace: true });
  };
  const accounts = useAccounts(plan?.id);
  const accountList = accounts.data ?? [];
  // Links never point at an unknown id: the open plan, else the last-opened one, else "/".
  // While the plan list loads, keep the id from the URL so an early click cannot jump to another plan.
  const target = plan?.id ?? (isLoading ? budgetId : undefined) ?? pickLastOpened(plans)?.id;
  const viewing = plan || isLoading ? parseMonthParam(monthMatch?.params.month) : null;

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
        <NavLink
          to={target ? planPath(target, viewing ?? lastMonth(target) ?? localCurrentMonth()) : "/"}
          className={() => (onPlan ? "active" : "")}
        >
          <PlanIcon />
          Plan
        </NavLink>
        <NavLink to={target ? reflectPath(target) : "/"}>
          <ReflectIcon />
          Reflect
        </NavLink>
        <NavLink to={target ? accountsPath(target) : "/"} end>
          <AccountsIcon />
          All Accounts
        </NavLink>
      </div>
      {plan && accountList.length > 0 ? (
        <SidebarAccounts budgetId={plan.id} accounts={accountList} />
      ) : null}
      {!plan || (accounts.isSuccess && accountList.length === 0) ? (
        <div className="accounts-card">
          <h5>No Accounts</h5>
          <p>You can't plan without adding accounts first. How about adding one now?</p>
        </div>
      ) : null}
      <button type="button" className="add-account" onClick={() => setAddAccount(true)}>
        <PlusCircleIcon />
        Add Account
      </button>
      {newPlan ? <NewPlanDialog onClose={() => setNewPlan(false)} /> : null}
      {addAccount ? <AddAccountDialog onClose={() => setAddAccount(false)} /> : null}
      {connectionsVariant ? (
        <AddAccountDialog
          variant="connections"
          onBack={clearConnections}
          onClose={clearConnections}
        />
      ) : null}
    </nav>
  );
}
