import type { AccountType } from "@budget/core/account-types";
import type { Account } from "@budget/schema/accounts";
import { parseAmountInput } from "@budget/schema/amount-input";
import type { BankConnection } from "@budget/schema/bank-connections";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { localToday, useCreateAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { AccountTypePicker } from "./AccountTypePicker";
import { ACCOUNT_TYPE_LABEL } from "./accountTypeLabels";
import { BankConnected } from "./BankConnected";
import { BankSearch } from "./BankSearch";
import { CaretRightIcon, CheckCircleIcon, ChevronLeftIcon, CloseIcon } from "./icons";
import { accountPath } from "./planPaths";
import { useCurrentPlan } from "./useCurrentPlan";

type Screen = "start" | "form" | "types" | "success" | "connected";
type Errors = { name?: string; balance?: string; other?: string };

const TITLES: Record<Screen, string> = {
  start: "Add Accounts",
  form: "Add Unlinked Account",
  types: "Select Account Type",
  success: "Add Unlinked Account",
  connected: "Add Accounts",
};

/**
 * "Add Accounts". `variant="connections"` is the one opened from Manage Bank Connections (EXF-460):
 * a Back arrow on the start screen, no "or" divider and no unlinked button.
 */
export function AddAccountDialog({
  onClose,
  variant = "sidebar",
  onBack,
}: {
  onClose: () => void;
  variant?: "sidebar" | "connections";
  onBack?: () => void;
}) {
  const { budgetId = "", plan } = useCurrentPlan();
  const navigate = useNavigate();
  const create = useCreateAccount(budgetId);
  const [screen, setScreen] = useState<Screen>("start");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType | null>(null);
  const [balance, setBalance] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] = useState<Account | null>(null);
  const [connection, setConnection] = useState<BankConnection | null>(null);
  const linkOpen = useRef(false);

  const title = TITLES[screen];
  const canGoBack =
    screen === "form" || screen === "types" || (screen === "start" && variant === "connections");
  const canSubmit = !!name.trim() && !!type && balance !== "" && !create.isPending;

  function closeDialog() {
    onClose();
    if (screen === "success" && created) navigate(accountPath(budgetId, created.id));
  }

  function back() {
    if (screen === "start") (onBack ?? onClose)();
    else setScreen(screen === "types" ? "form" : "start");
  }

  // Escape closes the modal, except while Plaid Link is open.
  const closeRef = useRef(closeDialog);
  closeRef.current = closeDialog;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !linkOpen.current) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function reset() {
    setName("");
    setType(null);
    setBalance("");
    setErrors({});
    setCreated(null);
    setScreen("start");
  }

  function submit() {
    if (!type) return;
    const milli = parseAmountInput(balance);
    if (milli === null) {
      setErrors({ balance: "Enter an amount" });
      return;
    }
    setErrors({});
    create.mutate(
      { name, type, balance: milli, date: localToday() },
      {
        onSuccess: (r) => {
          setCreated(r.account);
          setScreen("success");
        },
        onError: (e) => {
          if (e instanceof ApiError && e.errorName === "name_taken") {
            setErrors({ name: "This account name already exists." });
          } else {
            setErrors({ other: e.message });
          }
        },
      },
    );
  }

  return (
    <div className="dialog-backdrop top">
      <div className="dialog modal account-modal" role="dialog" aria-label={title}>
        <div className="dialog-head">
          {canGoBack ? (
            <button type="button" className="icon-button back" aria-label="Back" onClick={back}>
              <ChevronLeftIcon />
            </button>
          ) : null}
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={closeDialog}>
            <CloseIcon />
          </button>
        </div>
        <div className="account-modal-body">
          {screen === "start" ? (
            <>
              <BankSearch
                budgetId={budgetId}
                sandbox={plan?.bank_environment === "sandbox"}
                variant={variant}
                onUnlinked={() => setScreen("form")}
                onConnected={(c) => {
                  setConnection(c);
                  setScreen("connected");
                }}
                onLinkingChange={(v) => {
                  linkOpen.current = v;
                }}
              />
              {variant === "sidebar" ? (
                <>
                  <div className="or-divider">or</div>
                  <button
                    type="button"
                    className="secondary large"
                    onClick={() => setScreen("form")}
                  >
                    Add an Unlinked Account
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          {screen === "connected" && connection ? <BankConnected connection={connection} /> : null}
          {screen === "form" ? (
            <>
              <p className="intro">
                <strong>Let's go!</strong> And don’t worry—if you change your mind, you can link
                your account at any time.
              </p>
              <label htmlFor="account-name">Give it a nickname</label>
              <input
                id="account-name"
                className="account-field"
                // biome-ignore lint/a11y/noAutofocus: the source focuses the nickname when the form opens
                autoFocus
                autoCapitalize="words"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((s) => ({ ...s, name: undefined, other: undefined }));
                }}
              />
              {errors.name ? <p className="field-error">{errors.name}</p> : null}
              <p className="label">What type of account are you adding?</p>
              <button
                type="button"
                className="account-field select"
                onClick={() => setScreen("types")}
              >
                <span>{type ? ACCOUNT_TYPE_LABEL[type] : "Select account type..."}</span>
                <CaretRightIcon />
              </button>
              <label htmlFor="account-balance">What is your current account balance?</label>
              <input
                id="account-balance"
                className="account-field"
                inputMode="decimal"
                value={balance}
                onChange={(e) => {
                  setBalance(e.target.value);
                  setErrors((s) => ({ ...s, balance: undefined, other: undefined }));
                }}
              />
              {errors.balance ? <p className="field-error">{errors.balance}</p> : null}
              {errors.other ? <p className="field-error">{errors.other}</p> : null}
            </>
          ) : null}
          {screen === "types" ? (
            <AccountTypePicker
              value={type}
              onPick={(t) => {
                setType(t);
                setScreen("form");
              }}
            />
          ) : null}
          {screen === "success" ? (
            <div className="account-success">
              <CheckCircleIcon />
              <h3>Success!</h3>
              <p>
                Add transactions in the register, or import a transaction file with File Import.
              </p>
            </div>
          ) : null}
        </div>
        {screen === "form" ? (
          <div className="account-modal-footer">
            <button type="button" className="primary large" disabled={!canSubmit} onClick={submit}>
              Next
            </button>
          </div>
        ) : null}
        {screen === "connected" ? (
          <div className="account-modal-footer">
            <button type="button" className="primary large" onClick={onClose}>
              Done
            </button>
          </div>
        ) : null}
        {screen === "success" ? (
          <div className="account-modal-footer two">
            <button type="button" className="secondary large" onClick={reset}>
              Add Another
            </button>
            <button type="button" className="primary large" onClick={closeDialog}>
              Done
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
