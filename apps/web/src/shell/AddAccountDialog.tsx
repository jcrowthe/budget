import { type AccountType, isLoanType } from "@budget/core/account-types";
import { type Account, InterestRate } from "@budget/schema/accounts";
import { parseAmountInput } from "@budget/schema/amount-input";
import type { BankConnection } from "@budget/schema/bank-connections";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { localToday, useCreateAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { AddAccountTypePicker } from "./AddAccountTypePicker";
import { ACCOUNT_TYPE_LABEL } from "./accountTypeLabels";
import {
  EscrowStep,
  emptyPair,
  LoanBalanceFields,
  PairCategoryStep,
  type PairState,
  pairReady,
  pairRequest,
} from "./add-account-loan-steps";
import { BankSearch } from "./BankSearch";
import { BANK_LINK_TITLES, BankLinkAccounts, type BankLinkScreen } from "./bank-link-accounts";
import { CaretRightIcon, CheckCircleIcon, ChevronLeftIcon, CloseIcon } from "./icons";
import { usePlanFormatter } from "./plan-formats-context";
import { accountPath } from "./planPaths";
import { useCurrentPlan } from "./useCurrentPlan";

type Screen = "start" | "form" | "types" | "escrow" | "pair" | "success" | "link";
type Errors = { name?: string; balance?: string; rate?: string; other?: string };

const TITLES: Record<Screen, string> = {
  start: "Add Accounts",
  form: "Add Unlinked Account",
  types: "Select Account Type",
  escrow: "Add Unlinked Account",
  pair: "Optional: Pair a Category",
  success: "Add Unlinked Account",
  link: "Add Accounts",
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
  const fmt = usePlanFormatter();
  const navigate = useNavigate();
  const create = useCreateAccount(budgetId);
  const [screen, setScreen] = useState<Screen>("start");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType | null>(null);
  const [balance, setBalance] = useState("");
  const [rate, setRate] = useState("");
  const [payment, setPayment] = useState("");
  const [escrowYes, setEscrowYes] = useState(false);
  const [escrow, setEscrow] = useState("");
  const [pair, setPair] = useState<PairState>(emptyPair);
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] = useState<Account | null>(null);
  const [connection, setConnection] = useState<BankConnection | null>(null);
  const [linkScreen, setLinkScreen] = useState<BankLinkScreen>("select");
  const linkOpen = useRef(false);

  const title = screen === "link" ? BANK_LINK_TITLES[linkScreen] : TITLES[screen];
  const canGoBack =
    screen === "form" ||
    screen === "types" ||
    screen === "escrow" ||
    screen === "pair" ||
    (screen === "link" && linkScreen !== "select") ||
    (screen === "start" && variant === "connections");
  const loan = !!type && isLoanType(type);
  const canSubmit =
    !!name.trim() &&
    !!type &&
    balance !== "" &&
    (!loan || (rate !== "" && payment !== "")) &&
    !create.isPending;

  function closeDialog() {
    onClose();
    if (screen === "success" && created) navigate(accountPath(budgetId, created.id));
  }

  function back() {
    if (screen === "link") setLinkScreen("select");
    else if (screen === "start") (onBack ?? onClose)();
    else if (screen === "pair") setScreen(type === "mortgage" ? "escrow" : "form");
    else if (screen === "escrow") setScreen("form");
    else setScreen(screen === "types" ? "form" : "start");
  }

  // Escape closes the modal, except while Plaid Link is open; on a sub-screen of Add Accounts it goes back.
  const closeRef = useRef(closeDialog);
  closeRef.current = closeDialog;
  const escRef = useRef(() => {});
  escRef.current = () => {
    if (screen === "link" && linkScreen !== "select") setLinkScreen("select");
    else closeDialog();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !linkOpen.current) escRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function reset() {
    setName("");
    setType(null);
    setBalance("");
    setRate("");
    setPayment("");
    setEscrowYes(false);
    setEscrow("");
    setPair(emptyPair);
    setErrors({});
    setCreated(null);
    setScreen("start");
  }

  /** Checks the typed amounts (and the rate) of the form; sets the errors and returns null when one is bad. */
  function parseForm() {
    if (!type) return null;
    const milli = parseAmountInput(fmt.typedAmount(balance), fmt.digits);
    const next: Errors = {};
    if (milli === null) next.balance = "Enter an amount";
    let payMilli: number | null = null;
    if (loan) {
      payMilli = parseAmountInput(fmt.typedAmount(payment), fmt.digits);
      if (payMilli === null || payMilli < 0) next.balance = "Enter an amount";
      if (!InterestRate.safeParse(rate.trim()).success) {
        next.rate = "Enter a rate between 0 and 100";
      }
    }
    setErrors(next);
    if (next.balance || next.rate || milli === null) return null;
    return { milli, payMilli };
  }

  function nextFromForm() {
    if (!loan) return submit();
    if (!parseForm()) return;
    setScreen(type === "mortgage" ? "escrow" : "pair");
  }

  function submit(withPairing = false) {
    if (!type) return;
    const parsed = parseForm();
    if (!parsed) {
      if (screen !== "form") setScreen("form");
      return;
    }
    const escrowMilli =
      type === "mortgage" && escrowYes && escrow.trim() !== ""
        ? parseAmountInput(fmt.typedAmount(escrow), fmt.digits)
        : 0;
    if (escrowMilli === null || escrowMilli < 0) {
      setErrors({ other: "Enter a monthly escrow amount" });
      setScreen("escrow");
      return;
    }
    create.mutate(
      {
        name,
        type,
        balance: parsed.milli,
        date: localToday(),
        ...(loan
          ? {
              interest_rate: rate.trim(),
              minimum_payment: parsed.payMilli ?? 0,
              escrow_amount: escrowMilli,
              ...(withPairing ? pairRequest(pair) : {}),
            }
          : {}),
      },
      {
        onSuccess: (r) => {
          setCreated(r.account);
          setScreen("success");
        },
        onError: (e) => {
          if (e instanceof ApiError && e.errorName === "name_taken") {
            setErrors({ name: "This account name already exists." });
            setScreen("form");
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
        {screen === "link" ? null : (
          <div className="account-modal-body">
            {screen === "start" ? (
              <BankSearch
                budgetId={budgetId}
                sandbox={plan?.bank_environment === "sandbox"}
                variant={variant}
                onUnlinked={() => setScreen("form")}
                onConnected={(c) => {
                  setConnection(c);
                  setLinkScreen("select");
                  setScreen("link");
                }}
                onLinkingChange={(v) => {
                  linkOpen.current = v;
                }}
              />
            ) : null}
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
                {loan ? (
                  <LoanBalanceFields
                    balance={balance}
                    rate={rate}
                    payment={payment}
                    onBalance={(v) => {
                      setBalance(v);
                      setErrors((s) => ({ ...s, balance: undefined, other: undefined }));
                    }}
                    onRate={(v) => {
                      setRate(v);
                      setErrors((s) => ({ ...s, rate: undefined, other: undefined }));
                    }}
                    onPayment={(v) => {
                      setPayment(v);
                      setErrors((s) => ({ ...s, balance: undefined, other: undefined }));
                    }}
                  />
                ) : (
                  <>
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
                  </>
                )}
                {errors.rate ? <p className="field-error">{errors.rate}</p> : null}
                {errors.balance ? <p className="field-error">{errors.balance}</p> : null}
                {errors.other ? <p className="field-error">{errors.other}</p> : null}
              </>
            ) : null}
            {screen === "types" ? (
              <AddAccountTypePicker
                value={type}
                onPick={(t) => {
                  setType(t);
                  setScreen("form");
                }}
              />
            ) : null}
            {screen === "escrow" ? (
              <>
                <EscrowStep
                  yes={escrowYes}
                  amount={escrow}
                  onYes={setEscrowYes}
                  onAmount={(v) => {
                    setEscrow(v);
                    setErrors({});
                  }}
                />
                {errors.other ? <p className="field-error">{errors.other}</p> : null}
              </>
            ) : null}
            {screen === "pair" ? (
              <>
                <PairCategoryStep budgetId={budgetId} value={pair} onChange={setPair} />
                {errors.other ? <p className="field-error">{errors.other}</p> : null}
              </>
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
        )}
        {screen === "form" ? (
          <div className="account-modal-footer">
            <button
              type="button"
              className="primary large"
              disabled={!canSubmit}
              onClick={nextFromForm}
            >
              Next
            </button>
          </div>
        ) : null}
        {screen === "escrow" ? (
          <div className="account-modal-footer">
            <button type="button" className="primary large" onClick={() => setScreen("pair")}>
              Next
            </button>
          </div>
        ) : null}
        {screen === "pair" ? (
          <div className="account-modal-footer two">
            <button
              type="button"
              className="secondary large"
              disabled={create.isPending}
              onClick={() => submit(false)}
            >
              Skip
            </button>
            <button
              type="button"
              className="primary large"
              disabled={!pairReady(pair) || create.isPending}
              onClick={() => submit(true)}
            >
              Next
            </button>
          </div>
        ) : null}
        {screen === "link" && connection ? (
          <BankLinkAccounts
            budgetId={budgetId}
            connection={connection}
            sandbox={plan?.bank_environment === "sandbox"}
            screen={linkScreen}
            onScreen={setLinkScreen}
            onDone={onClose}
          />
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
