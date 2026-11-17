import type { Account } from "@budget/schema/accounts";
import { bankAccountLabel, planAccountType } from "@budget/schema/bank-link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  invalidateBankLink,
  linkAccount,
  startPlanSync,
  useBankConnections,
} from "../api/bank-link";
import { useBudgets } from "../api/budgets";
import { localToday } from "../api/today";
import { BankSearch } from "../shell/BankSearch";
import { useBankSubline } from "../shell/bank-link-accounts";
import { ChevronLeftIcon, CloseIcon } from "../shell/icons";
import "./link-account.css";

export type ChooserView = "list" | "new";

/** Whether the plan is a Sandbox plan (the pill the bank search shows). */
function useSandbox(budgetId: string): boolean {
  const budgets = useBudgets();
  return budgets.data?.find((b) => b.id === budgetId)?.bank_environment === "sandbox";
}

/**
 * The body of Link Account: the plan's bank accounts that are not linked here, and `Add a New Bank
 * Connection`. Also used by /plaid/oauth when Link Account started the bank's sign-in.
 */
export function LinkAccountChooser({
  budgetId,
  account,
  view,
  onView,
  onLinked,
  onLinkingChange,
}: {
  budgetId: string;
  account: Account;
  view: ChooserView;
  onView: (v: ChooserView) => void;
  onLinked: () => void;
  onLinkingChange?: (linking: boolean) => void;
}) {
  const qc = useQueryClient();
  const sandbox = useSandbox(budgetId);
  const connections = useBankConnections(budgetId);
  const subline = useBankSubline();
  const link = useMutation({
    mutationFn: (bankAccountId: string) =>
      linkAccount(budgetId, account.id, { bank_account_id: bankAccountId, today: localToday() }),
    onSuccess: () => {
      invalidateBankLink(qc, budgetId);
      startPlanSync(qc, budgetId);
      onLinked();
    },
  });

  if (view === "new") {
    return (
      <BankSearch
        budgetId={budgetId}
        sandbox={sandbox}
        variant="connections"
        linkAccountId={account.id}
        onUnlinked={() => {}}
        onConnected={() => {
          invalidateBankLink(qc, budgetId);
          onView("list");
        }}
        onLinkingChange={onLinkingChange}
      />
    );
  }

  const groups = (connections.data ?? [])
    .map((c) => ({ c, rows: c.accounts.filter((a) => a.linked_account_id === null) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="link-account">
      <div className="bank-link-bank">
        <p className="bank-link-intro" title={account.name}>
          Choose the bank account to link to "{account.name}".
        </p>
        {sandbox ? (
          <span className="env-pill" title="Plaid Sandbox: test banks only">
            Sandbox
          </span>
        ) : null}
      </div>
      {connections.isSuccess && groups.length === 0 ? (
        <p className="bank-link-note">
          There are no bank accounts to link. Add a new bank connection to link this account.
        </p>
      ) : null}
      {groups.map(({ c, rows }) => (
        <section key={c.id} className="link-account-group">
          <h3 title={c.nickname}>{c.nickname}</h3>
          {rows.map((a) => {
            const label = bankAccountLabel(a.name, a.mask);
            const sub = subline(a, planAccountType(a.type, a.subtype));
            return (
              <button
                key={a.id}
                type="button"
                className="link-account-row"
                disabled={link.isPending}
                onClick={() => link.mutate(a.id)}
              >
                <span className="bank-link-name" title={label}>
                  {label}
                </span>
                <span className="bank-link-sub" title={sub}>
                  {sub}
                </span>
              </button>
            );
          })}
        </section>
      ))}
      <button
        type="button"
        className="link-account-row link-account-new"
        disabled={link.isPending}
        onClick={() => onView("new")}
      >
        <span className="bank-link-name">Add a New Bank Connection</span>
      </button>
      {link.isError ? (
        <p className="field-error" role="alert">
          {link.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** "Link Account": its own modal over Edit Account (it embeds the bank search). */
export function LinkAccountDialog({
  budgetId,
  account,
  onBack,
  onLinked,
}: {
  budgetId: string;
  account: Account;
  onBack: () => void;
  onLinked: () => void;
}) {
  const [view, setView] = useState<ChooserView>("list");
  const linkOpen = useRef(false);
  const esc = useRef(() => {});
  esc.current = () => {
    if (linkOpen.current) return;
    if (view === "new") setView("list");
    else onBack();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") esc.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="dialog-backdrop top">
      <div className="dialog modal account-modal" role="dialog" aria-label="Link Account">
        <div className="dialog-head">
          <button
            type="button"
            className="icon-button back"
            aria-label="Back"
            onClick={() => (view === "new" ? setView("list") : onBack())}
          >
            <ChevronLeftIcon />
          </button>
          <h2>Link Account</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onBack}>
            <CloseIcon />
          </button>
        </div>
        <div className="account-modal-body bank-link-body">
          <LinkAccountChooser
            budgetId={budgetId}
            account={account}
            view={view}
            onView={setView}
            onLinked={onLinked}
            onLinkingChange={(v) => {
              linkOpen.current = v;
            }}
          />
        </div>
      </div>
    </div>
  );
}
