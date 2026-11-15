import { useState } from "react";
import { NavLink, useMatch } from "react-router";
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
import { pickLastOpened, useCurrentPlan } from "./useCurrentPlan";

export function Sidebar() {
  const { plan, plans } = useCurrentPlan();
  const monthMatch = useMatch("/:budgetId/budget/:month");
  const onPlan = !!useMatch("/:budgetId/budget/*");
  const [menu, setMenu] = useState(false);
  const [newPlan, setNewPlan] = useState(false);
  const [addAccount, setAddAccount] = useState(false);
  // Links never point at an unknown id: the open plan, else the last-opened one, else "/".
  const target = plan?.id ?? pickLastOpened(plans)?.id;
  const viewing = plan ? parseMonthParam(monthMatch?.params.month) : null;

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
