import { formatMoney } from "@budget/core/money";
import type { Account } from "@budget/schema/accounts";
import { parseAmountInput } from "@budget/schema/amount-input";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  localToday,
  useAdjustBalance,
  useCloseAccount,
  useDeleteAccount,
  useReopenAccount,
  useUpdateAccount,
} from "../api/accounts";
import { ApiError } from "../api/client";
import { CloseIcon } from "../shell/icons";
import { accountsPath } from "../shell/planPaths";
import { CloseAccountDialog } from "./CloseAccountDialog";
import "./edit-account.css";

type Errors = { name?: string; balance?: string; other?: string };

const CLOSE_TIP =
  "Closing an account retains the transaction history for your plan. If you'd like to delete an account, start by closing the account first.";
const DELETE_TIP =
  "If you want to delete this account, first delete all of the transactions in it and transfers pointing to it. Be cautious, as this will potentially change your plan values.";
const HELPER = "An adjustment transaction will be created automatically if you change this amount.";

/** The balance as the field shows it: signed, with thousands separators and no currency sign. */
const balanceText = (balance: number) => formatMoney(balance).replace("$", "");

/** "Edit Account": nickname, notes and (open accounts) the balance, plus close, delete and re-open. */
export function EditAccountDialog({
  budgetId,
  account,
  onClose,
}: {
  budgetId: string;
  account: Account;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const update = useUpdateAccount(budgetId, account.id);
  const adjust = useAdjustBalance(budgetId, account.id);
  const close = useCloseAccount(budgetId, account.id);
  const reopen = useReopenAccount(budgetId, account.id);
  const remove = useDeleteAccount(budgetId, account.id);
  const prefill = balanceText(account.balance);
  const [name, setName] = useState(account.name);
  const [note, setNote] = useState(account.note ?? "");
  const [balance, setBalance] = useState(prefill);
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = saving || close.isPending || reopen.isPending || remove.isPending;

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const clear = (key: keyof Errors) =>
    setErrors((s) => ({ ...s, [key]: undefined, other: undefined }));
  const fail = (e: Error) => setErrors({ other: e.message });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setErrors({ name: "The account name is required." });
      return;
    }
    let target: number | null = null;
    if (!account.closed && balance !== prefill) {
      target = parseAmountInput(balance);
      if (target === null) {
        setErrors({ balance: "Enter an amount" });
        return;
      }
    }
    setErrors({});
    const patch: { name?: string; note?: string | null } = {};
    if (trimmed !== account.name) patch.name = trimmed;
    const nextNote = note.trim() ? note : null;
    if (nextNote !== account.note) patch.note = nextNote;
    setSaving(true);
    try {
      if (Object.keys(patch).length > 0) {
        try {
          await update.mutateAsync(patch);
        } catch (err) {
          if (err instanceof ApiError && err.errorName === "name_taken") {
            setErrors({ name: "This account name already exists." });
          } else if (err instanceof ApiError && err.errorName === "name_required") {
            setErrors({ name: "The account name is required." });
          } else {
            fail(err as Error);
          }
          return;
        }
      }
      if (target !== null && target !== account.balance) {
        try {
          await adjust.mutateAsync({ balance: target, today: localToday() });
        } catch (err) {
          setErrors({ balance: (err as Error).message });
          return;
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function closeAccount() {
    if (account.balance !== 0) {
      setConfirming(true);
      return;
    }
    close.mutate({ today: localToday() }, { onSuccess: onClose, onError: fail });
  }

  if (confirming) {
    return (
      <CloseAccountDialog
        account={account}
        busy={close.isPending}
        error={errors.other}
        onCancel={onClose}
        onConfirm={() =>
          close.mutate({ today: localToday() }, { onSuccess: onClose, onError: fail })
        }
      />
    );
  }

  const deleteAccount = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        navigate(accountsPath(budgetId));
        onClose();
      },
      onError: fail,
    });

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form edit-account"
        role="dialog"
        aria-modal="true"
        aria-label="Edit Account"
        noValidate
        onSubmit={save}
      >
        <div className="dialog-head">
          <h2>Edit Account</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="form-body">
          <h3>Account Information</h3>
          <label htmlFor="edit-account-name">Account Nickname</label>
          <input
            id="edit-account-name"
            className="field"
            // biome-ignore lint/a11y/noAutofocus: the source focuses the nickname when the dialog opens
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clear("name");
            }}
          />
          {errors.name ? (
            <p className="error-bar" role="alert">
              {errors.name}
            </p>
          ) : null}
          <label htmlFor="edit-account-note">Account Notes</label>
          <textarea
            id="edit-account-note"
            className="field"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {account.closed ? null : (
            <>
              <hr />
              <label htmlFor="edit-account-balance">
                {account.on_budget ? "Working Balance" : "Today's Balance"}
              </label>
              <input
                id="edit-account-balance"
                className="field"
                inputMode="decimal"
                value={balance}
                onChange={(e) => {
                  setBalance(e.target.value);
                  clear("balance");
                }}
              />
              {errors.balance ? (
                <p className="error-bar" role="alert">
                  {errors.balance}
                </p>
              ) : null}
              <p className="helper">{HELPER}</p>
            </>
          )}
          {errors.other ? (
            <p className="error-bar" role="alert">
              {errors.other}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <div className="footer-left">
            {account.closed ? (
              <>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => reopen.mutate(undefined, { onSuccess: onClose, onError: fail })}
                >
                  Re-open
                </button>
                <button
                  type="button"
                  className="destructive"
                  disabled={busy || !account.can_delete}
                  title={account.can_delete ? undefined : DELETE_TIP}
                  onClick={deleteAccount}
                >
                  Delete
                </button>
              </>
            ) : account.can_delete ? (
              <button type="button" className="destructive" disabled={busy} onClick={deleteAccount}>
                Delete Account
              </button>
            ) : (
              <button
                type="button"
                className="destructive"
                disabled={busy}
                title={CLOSE_TIP}
                onClick={closeAccount}
              >
                Close Account
              </button>
            )}
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
