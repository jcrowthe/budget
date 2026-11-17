import type { BankConnection } from "@budget/schema/bank-connections";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { createBankConnection } from "../api/bank-connections";
import { useBudgets } from "../api/budgets";
import { ApiError } from "../api/client";
import {
  BANK_LINK_TITLES,
  BankLinkAccounts,
  type BankLinkScreen,
} from "../shell/bank-link-accounts";
import { ChevronLeftIcon, CloseIcon } from "../shell/icons";
import { loadPlaidLink, plaidExitMessage, takeLinkState } from "../shell/plaidLink";
import { PlanFormatsProvider } from "../shell/plan-formats-context";
import { useDocumentTitle } from "../shell/useCurrentPlan";

type State =
  | { kind: "resuming" }
  | { kind: "missing" }
  | { kind: "exit"; budgetId: string; message: string | null }
  | { kind: "error"; budgetId: string; message: string }
  | { kind: "done"; budgetId: string; connection: BankConnection };

/** The same Add Accounts step as the dialog, for the plan the saved state names. */
function Done({ budgetId, connection }: { budgetId: string; connection: BankConnection }) {
  const navigate = useNavigate();
  const budgets = useBudgets();
  const sandbox = budgets.data?.find((b) => b.id === budgetId)?.bank_environment === "sandbox";
  const [screen, setScreen] = useState<BankLinkScreen>("select");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (screen === "select") navigate(`/${budgetId}/budget`);
      else setScreen("select");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen, budgetId, navigate]);
  return (
    <div className="dialog-backdrop top">
      <div
        className="dialog modal account-modal"
        role="dialog"
        aria-label={BANK_LINK_TITLES[screen]}
      >
        <div className="dialog-head">
          {screen !== "select" ? (
            <button
              type="button"
              className="icon-button back"
              aria-label="Back"
              onClick={() => setScreen("select")}
            >
              <ChevronLeftIcon />
            </button>
          ) : null}
          <h2>{BANK_LINK_TITLES[screen]}</h2>
          <Link className="icon-button" aria-label="Close" to={`/${budgetId}/budget`}>
            <CloseIcon />
          </Link>
        </div>
        <PlanFormatsProvider budgetId={budgetId}>
          <BankLinkAccounts
            budgetId={budgetId}
            connection={connection}
            sandbox={sandbox}
            screen={screen}
            onScreen={setScreen}
            onDone={() => navigate(`/${budgetId}/budget`)}
          />
        </PlanFormatsProvider>
      </div>
    </div>
  );
}

/** Resumes Plaid Link after an OAuth bank's redirect, then finishes like the Add Accounts dialog. */
function PlaidOAuthPage() {
  useDocumentTitle("Bank Connection | Budget");
  const [state, setState] = useState<State>({ kind: "resuming" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice
    started.current = true;
    const saved = takeLinkState();
    if (!saved) {
      setState({ kind: "missing" });
      return;
    }
    const budgetId = saved.budget_id;
    loadPlaidLink()
      .then((plaid) =>
        plaid
          .create({
            token: saved.link_token,
            receivedRedirectUri: window.location.href,
            onSuccess: async (public_token, metadata) => {
              try {
                const connection = await createBankConnection({
                  budget_id: budgetId,
                  public_token,
                  institution_id: metadata?.institution?.institution_id ?? "unknown",
                  institution_name: metadata?.institution?.name,
                });
                setState({ kind: "done", budgetId, connection });
              } catch (e) {
                setState({
                  kind: "error",
                  budgetId,
                  message: e instanceof ApiError ? e.detail : "Something went wrong. Try again.",
                });
              }
            },
            onExit: (err) => setState({ kind: "exit", budgetId, message: plaidExitMessage(err) }),
          })
          .open(),
      )
      .catch(() =>
        setState({ kind: "error", budgetId, message: "Plaid Link could not be loaded." }),
      );
  }, []);

  const back =
    state.kind === "resuming" || state.kind === "missing" ? "/" : `/${state.budgetId}/budget`;

  if (state.kind === "done")
    return <Done budgetId={state.budgetId} connection={state.connection} />;

  return (
    <div className="dialog-backdrop top">
      <div className="dialog modal account-modal" role="dialog" aria-label="Add Accounts">
        <div className="dialog-head">
          <h2>Add Accounts</h2>
          <Link className="icon-button" aria-label="Close" to={back}>
            <CloseIcon />
          </Link>
        </div>
        <div className="account-modal-body">
          {state.kind === "resuming" ? (
            <p className="bank-no-match">Reconnecting to your bank…</p>
          ) : null}
          {state.kind === "missing" ? (
            <p className="bank-no-match">
              This bank connection could not be resumed.
              <br />
              <br />
              <Link className="link-button" to="/">
                Back to Budget
              </Link>
            </p>
          ) : null}
          {state.kind === "exit" || state.kind === "error" ? (
            <p className="bank-no-match">
              {state.kind === "exit"
                ? "The bank connection was not completed."
                : "The bank connection could not be saved."}
              {state.message ? (
                <>
                  <br />
                  <br />
                  {state.message}
                </>
              ) : null}
              <br />
              <br />
              <Link className="link-button" to={`/${state.budgetId}/budget`}>
                Back to Budget
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const page = { path: "/plaid/oauth", element: <PlaidOAuthPage /> };
