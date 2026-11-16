import type { Account } from "@budget/schema/accounts";
import { type ComponentType, useRef, useState } from "react";
import { NavLink, useMatch, useSearchParams } from "react-router";
import { EditAccountDialog } from "../account/EditAccountDialog";
import { useAccounts } from "../api/accounts";
import { identityLabel, useMe } from "../api/me";
import { AddAccountDialog } from "./AddAccountDialog";
import { AccountsIcon, CaretIcon, Logo, PlanIcon, PlusCircleIcon, ReflectIcon } from "./icons";
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
  const [menu, setMenu] = useState<null | { keyboard: boolean; focus: "first" | "last" }>(null);
  const [dialog, setDialog] = useState<null | {
    Dialog: ComponentType<{ budgetId: string | null; onClose: () => void }>;
  }>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = identityLabel(useMe().data);
  const [addAccount, setAddAccount] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
        ref={buttonRef}
        type="button"
        className="plan-button"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-controls={menu ? "plan-menu" : undefined}
        aria-label={plan?.name ?? "Budget"}
        aria-describedby={label ? "plan-identity" : undefined}
        onClick={(e) => setMenu((m) => (m ? null : { keyboard: e.detail === 0, focus: "first" }))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setMenu({ keyboard: true, focus: e.key === "ArrowDown" ? "first" : "last" });
          }
        }}
      >
        <Logo className="logo" />
        <span className="plan-text">
          <span className="name">{plan?.name ?? "Budget"}</span>
          {label ? (
            <span id="plan-identity" className="identity">
              {label}
            </span>
          ) : null}
        </span>
        <CaretIcon />
      </button>
      {menu ? (
        <PlanMenu
          anchorRef={buttonRef}
          openedByKeyboard={menu.keyboard}
          initialFocus={menu.focus}
          onClose={({ focusButton }) => {
            setMenu(null);
            if (focusButton) buttonRef.current?.focus();
          }}
          onDialog={(a) => setDialog({ Dialog: a.Dialog })}
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
        <SidebarAccounts budgetId={plan.id} accounts={accountList} onEdit={setEditingId} />
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
      {dialog ? (
        <dialog.Dialog budgetId={plan?.id ?? null} onClose={() => setDialog(null)} />
      ) : null}
      {plan && editingId && accountList.find((a) => a.id === editingId) ? (
        <EditAccountDialog
          budgetId={plan.id}
          account={accountList.find((a) => a.id === editingId) as Account}
          onClose={() => setEditingId(null)}
        />
      ) : null}
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
