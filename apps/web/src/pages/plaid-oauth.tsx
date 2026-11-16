import type { BankConnection } from "@budget/schema/bank-connections";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { createBankConnection } from "../api/bank-connections";
import { ApiError } from "../api/client";
import { BankConnected } from "../shell/BankConnected";
import { CloseIcon } from "../shell/icons";
import { loadPlaidLink, plaidExitMessage, takeLinkState } from "../shell/plaidLink";
import { useDocumentTitle } from "../shell/useCurrentPlan";

type State =
  | { kind: "resuming" }
  | { kind: "missing" }
  | { kind: "exit"; budgetId: string; message: string | null }
  | { kind: "error"; budgetId: string; message: string }
  | { kind: "done"; budgetId: string; connection: BankConnection };

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
          {state.kind === "done" ? <BankConnected connection={state.connection} /> : null}
        </div>
        {state.kind === "done" ? (
          <div className="account-modal-footer">
            <Link className="primary large done-link" to={`/${state.budgetId}/budget`}>
              Done
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const page = { path: "/plaid/oauth", element: <PlaidOAuthPage /> };
