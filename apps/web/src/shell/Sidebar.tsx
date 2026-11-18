import { type ComponentType, useRef, useState } from "react";
import { NavLink, useMatch } from "react-router";
import { EditAccountDialog } from "../account/EditAccountDialog";
import { useAccounts } from "../api/accounts";
import { identityLabel, useMe } from "../api/me";
import { useShortcut } from "../shortcuts/dispatcher";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";
import { AddAccountDialog } from "./AddAccountDialog";
import {
  AccountsIcon,
  BankIcon,
  CaretIcon,
  Logo,
  PlanIcon,
  PlusCircleIcon,
  ReflectIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
} from "./icons";
import { ManageConnectionsDialog } from "./manage-connections-dialog";
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
import { useSidebarState } from "./useSidebarState";

export function Sidebar() {
  const { budgetId, plan, plans, isLoading, error } = useCurrentPlan();
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
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const accounts = useAccounts(plan?.id);
  const accountList = accounts.data ?? [];
  const editing = accountList.find((a) => a.id === editingId);
  // Links never point at an unknown id: the open plan, else the last-opened one, else "/".
  // While the plan list loads, keep the id from the URL so an early click cannot jump to another plan.
  const target = plan?.id ?? (isLoading ? budgetId : undefined) ?? pickLastOpened(plans)?.id;
  const side = useSidebarState();
  const rail = side.showRail;
  const notFound = !!budgetId && !isLoading && !error && !plan;
  // /plans (and "/" with no plan at all) shows the plans page: no plan is current, so nothing of one plan shows.
  const onPlansRoute = !!useMatch("/plans");
  const atRoot = !!useMatch("/");
  const plansPage = onPlansRoute || (atRoot && !isLoading && !error && plans.length === 0);
  const noPlan = notFound || plansPage;
  const planName = noPlan ? "No Plan Open" : (plan?.name ?? "Budget");
  const toggle = () => {
    setMenu(null);
    side.toggle();
  };
  useShortcut("toggle-sidebar", toggle);
  const viewing = plan || isLoading ? parseMonthParam(monthMatch?.params.month) : null;

  return (
    <nav
      className={[
        "sidebar",
        rail ? "is-collapsed" : "",
        side.narrow && !rail ? "is-narrow" : "",
        side.dragging ? "is-resizing" : "",
        side.transitioning ? "is-transitioning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Sidebar"
      style={{ "--sidebar-width": `${side.width}px` } as React.CSSProperties}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "width") side.endTransition();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={rail ? "rail-logo" : "plan-button"}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-controls={menu ? "plan-menu" : undefined}
        aria-label={planName}
        aria-describedby={label && !rail ? "plan-identity" : undefined}
        onClick={(e) => setMenu((m) => (m ? null : { keyboard: e.detail === 0, focus: "first" }))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setMenu({ keyboard: true, focus: e.key === "ArrowDown" ? "first" : "last" });
          }
        }}
      >
        <Logo className="logo" />
        {rail ? null : (
          <>
            <span className="plan-text">
              <span className="name">{planName}</span>
              {label ? (
                <span id="plan-identity" className="identity">
                  {label}
                </span>
              ) : null}
            </span>
            <CaretIcon />
          </>
        )}
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
          placement={rail ? "beside" : "below"}
        />
      ) : null}
      <div className="sidebar-scroll">
        {noPlan ? null : (
          <div className="nav">
            <NavLink
              aria-label={rail ? "Plan" : undefined}
              to={
                target ? planPath(target, viewing ?? lastMonth(target) ?? localCurrentMonth()) : "/"
              }
              className={() => (onPlan ? "active" : "")}
            >
              <PlanIcon />
              {rail ? null : "Plan"}
            </NavLink>
            <NavLink
              aria-label={rail ? "Reflect" : undefined}
              to={target ? reflectPath(target) : "/"}
            >
              <ReflectIcon />
              {rail ? null : "Reflect"}
            </NavLink>
            <NavLink
              aria-label={rail ? "All Accounts" : undefined}
              to={target ? accountsPath(target) : "/"}
              end
            >
              <AccountsIcon />
              {rail ? null : "All Accounts"}
            </NavLink>
          </div>
        )}
        {!rail && !noPlan && plan && accountList.length > 0 ? (
          <SidebarAccounts budgetId={plan.id} accounts={accountList} onEdit={setEditingId} />
        ) : null}
        {!rail && !noPlan && (!plan || (accounts.isSuccess && accountList.length === 0)) ? (
          <div className="accounts-card">
            <h5>No Accounts</h5>
            <p>You can't plan without adding accounts first. How about adding one now?</p>
          </div>
        ) : null}
        {rail || noPlan ? null : (
          <button type="button" className="add-account" onClick={() => setAddAccount(true)}>
            <PlusCircleIcon />
            Add Account
          </button>
        )}
        {rail || noPlan || !plan ? null : (
          <button
            type="button"
            className="add-account bank-connections"
            onClick={() => setConnectionsOpen(true)}
          >
            <BankIcon />
            {side.narrow ? "Connections" : "Bank Connections"}
          </button>
        )}
      </div>
      <div className="sidebar-bottom">
        <ShortcutTooltip id="toggle-sidebar" align={rail ? "start" : "center"}>
          {(tip) => (
            <button
              type="button"
              className={rail ? "sidebar-expand" : "sidebar-collapse"}
              aria-label="Expand/Collapse Sidebar"
              onClick={toggle}
              {...tip}
            >
              {rail ? <SidebarOpenIcon /> : <SidebarCloseIcon />}
            </button>
          )}
        </ShortcutTooltip>
      </div>
      {plansPage ? null : (
        <div className="sidebar-resizer" aria-hidden="true" onMouseDown={side.onResizerMouseDown}>
          <span className="sidebar-resizer-indicator" />
        </div>
      )}
      {dialog ? (
        <dialog.Dialog budgetId={plan?.id ?? null} onClose={() => setDialog(null)} />
      ) : null}
      {plan && editing ? (
        <EditAccountDialog
          budgetId={plan.id}
          account={editing}
          onClose={() => setEditingId(null)}
        />
      ) : null}
      {addAccount && !noPlan ? <AddAccountDialog onClose={() => setAddAccount(false)} /> : null}
      {connectionsOpen && plan && !noPlan ? (
        <ManageConnectionsDialog budgetId={plan.id} onClose={() => setConnectionsOpen(false)} />
      ) : null}
    </nav>
  );
}
