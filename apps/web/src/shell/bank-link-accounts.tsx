import type { AccountType } from "@budget/core/account-types";
import type { AccountsFromBankRequest } from "@budget/schema/accounts";
import type { BankAccount, BankConnection } from "@budget/schema/bank-connections";
import {
  addAccountsLabel,
  bankAccountLabel,
  defaultAccountName,
  planAccountType,
  planBalanceOf,
} from "@budget/schema/bank-link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccounts } from "../api/accounts";
import { createAccountsFromBank, invalidateBankLink, startPlanSync } from "../api/bank-link";
import { localToday } from "../api/today";
import { ACCOUNT_TYPE_GROUPS, ACCOUNT_TYPE_LABEL } from "./accountTypeLabels";
import "./bank-link.css";
import { usePlanFormatter } from "./plan-formats-context";

export type BankLinkScreen = "select" | "edit" | "summary";

/** The titles of the host's header for each screen. */
export const BANK_LINK_TITLES: Record<BankLinkScreen, string> = {
  select: "Add Accounts",
  edit: "Account Details",
  summary: "Add Accounts",
};

type Override = { name: string; type: AccountType };

/** Every type a bank account can become: Cash is not offered. */
const TYPE_CHOICES = ACCOUNT_TYPE_GROUPS.flatMap((g) => g.types).filter((t) => t !== "cash");

/** "<Type> | <balance>" under a bank account's name. */
export function useBankSubline() {
  const fmt = usePlanFormatter();
  return (a: BankAccount, type: AccountType) =>
    `${ACCOUNT_TYPE_LABEL[type]} | ${
      a.current_balance === null ? "—" : fmt.money(planBalanceOf(a.type, a.current_balance))
    }`;
}

/**
 * The Add Accounts step after a connection: choose the bank's accounts, edit a name or type, review, add.
 * The host owns the screen (title and Back); this holds the ticks and edits and renders body and footer.
 */
export function BankLinkAccounts({
  budgetId,
  connection,
  sandbox,
  screen,
  onScreen,
  onDone,
}: {
  budgetId: string;
  connection: BankConnection;
  sandbox: boolean;
  screen: BankLinkScreen;
  onScreen: (s: BankLinkScreen) => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const accounts = useAccounts(budgetId);
  const subline = useBankSubline();
  const rows = connection.accounts;
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.linked_account_id === null).map((r) => r.id)),
  );
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Override>({ name: "", type: "checking" });
  const [draftError, setDraftError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proposed = (r: BankAccount): Override => ({
    name: defaultAccountName(r),
    type: planAccountType(r.type, r.subtype),
  });
  const effective = (r: BankAccount): Override => overrides[r.id] ?? proposed(r);
  const labelOf = (r: BankAccount) => bankAccountLabel(effective(r).name, r.mask);
  const chosen = rows.filter((r) => ticked.has(r.id));
  const tickable = rows.filter((r) => r.linked_account_id === null);

  const add = useMutation({
    mutationFn: () => {
      const edited: NonNullable<AccountsFromBankRequest["overrides"]> = {};
      for (const r of chosen) {
        const o = overrides[r.id];
        if (o) edited[r.id] = { name: o.name, type: o.type };
      }
      return createAccountsFromBank(budgetId, {
        bank_account_ids: chosen.map((r) => r.id),
        ...(Object.keys(edited).length > 0 ? { overrides: edited } : {}),
        today: localToday(),
      });
    },
    onSuccess: () => {
      invalidateBankLink(qc, budgetId);
      startPlanSync(qc, budgetId);
      onDone();
    },
    onError: (e) => setError(e.message),
  });

  function startEdit(r: BankAccount) {
    setDraft(effective(r));
    setDraftError(null);
    setEditing(r.id);
    onScreen("edit");
  }

  function saveEdit() {
    const r = rows.find((x) => x.id === editing);
    if (!r) return;
    const name = draft.name.trim();
    if (name === "") {
      setDraftError("The account name is required.");
      return;
    }
    const base = proposed(r);
    setOverrides((o) => {
      const next = { ...o };
      if (name === base.name && draft.type === base.type) delete next[r.id];
      else next[r.id] = { name, type: draft.type };
      return next;
    });
    onScreen("select");
  }

  function toggle(id: string, on: boolean) {
    setTicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const linkedName = (r: BankAccount) =>
    accounts.data?.find((a) => a.id === r.linked_account_id)?.name;

  return (
    <>
      <div className="account-modal-body bank-link-body">
        {screen === "select" ? (
          <>
            <div className="bank-link-bank">
              <h3 title={connection.institution_name}>{connection.institution_name}</h3>
              {sandbox ? (
                <span className="env-pill" title="Plaid Sandbox: test banks only">
                  Sandbox
                </span>
              ) : null}
            </div>
            {tickable.length === 0 ? (
              <p className="bank-link-note">
                Every account of this bank is already linked in this plan.
              </p>
            ) : null}
            <ul className="bank-link-list">
              {rows.map((r) => {
                const linked = r.linked_account_id !== null;
                const label = labelOf(r);
                const sub = subline(r, effective(r).type);
                return (
                  <li key={r.id} className={linked ? "bank-link-row is-linked" : "bank-link-row"}>
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={ticked.has(r.id)}
                      disabled={linked}
                      onChange={(e) => toggle(r.id, e.target.checked)}
                    />
                    <span className="bank-link-text">
                      <span className="bank-link-name" title={label}>
                        {label}
                      </span>
                      <span className="bank-link-sub" title={sub}>
                        {sub}
                      </span>
                    </span>
                    {linked ? (
                      <span
                        className="bank-link-pill"
                        title={`Already linked to "${linkedName(r) ?? "an account"}" in this plan`}
                      >
                        Linked
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        aria-label={`Edit ${label}`}
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="bank-link-note">
              Accounts you leave unchecked can be linked later from an account's Edit Account.
            </p>
          </>
        ) : null}

        {screen === "edit" ? (
          <>
            <label htmlFor="bank-link-name">Account Nickname</label>
            <input
              id="bank-link-name"
              className="account-field"
              // biome-ignore lint/a11y/noAutofocus: the nickname is what a person changes here
              autoFocus
              maxLength={100}
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setDraftError(null);
              }}
            />
            {draftError ? <p className="field-error">{draftError}</p> : null}
            <label htmlFor="bank-link-type">Account Type</label>
            <select
              id="bank-link-type"
              className="account-field"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as AccountType })}
            >
              {TYPE_CHOICES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <p className="bank-link-note">The type of account cannot be changed once created.</p>
          </>
        ) : null}

        {screen === "summary" ? (
          <>
            <p className="bank-link-intro">
              These accounts will be added to your plan, each with a Starting Balance dated today:
            </p>
            <ul className="bank-link-list">
              {chosen.map((r) => {
                const label = labelOf(r);
                const sub = subline(r, effective(r).type);
                return (
                  <li key={r.id} className="bank-link-row summary">
                    <span />
                    <span className="bank-link-text">
                      <span className="bank-link-name" title={label}>
                        {label}
                      </span>
                      <span className="bank-link-sub" title={sub}>
                        {sub}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {error ? (
              <p className="field-error error-bar" role="alert">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="account-modal-footer">
        {screen === "select" ? (
          <button
            type="button"
            className="primary large"
            disabled={chosen.length === 0}
            onClick={() => {
              setError(null);
              onScreen("summary");
            }}
          >
            Next
          </button>
        ) : null}
        {screen === "edit" ? (
          <button type="button" className="primary large" onClick={saveEdit}>
            Save
          </button>
        ) : null}
        {screen === "summary" ? (
          <button
            type="button"
            className="primary large"
            disabled={add.isPending || chosen.length === 0}
            onClick={() => {
              setError(null);
              add.mutate();
            }}
          >
            {addAccountsLabel(chosen.length)}
          </button>
        ) : null}
      </div>
    </>
  );
}
