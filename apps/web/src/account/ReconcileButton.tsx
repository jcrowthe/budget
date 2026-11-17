import { parseAmountInput } from "@budget/schema/amount-input";
import { MINUS } from "@budget/schema/screen-money";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useSaveUiState, useUiState } from "../api/ui-state";
import { useShortcut } from "../shortcuts/dispatcher";
import { DifferenceDialog } from "./DifferenceDialog";
import { LockCheckArt } from "./icons";
import { useReconcile } from "./ReconcileContext";
import { Tooltip } from "./Tooltip";
import "./reconcile.css";
import { usePlanFormatter } from "../shell/plan-formats-context";

/** The header's Reconcile button with its tooltip, `shift+E`, and the popover steps under it. */
export function ReconcileButton() {
  const rc = useReconcile();
  const ui = useUiState(rc?.account.budget_id);
  const saveUi = useSaveUiState(rc?.account.budget_id ?? "");
  const wrap = useRef<HTMLSpanElement>(null);
  const idle = rc?.step === "idle";
  const closed = rc?.account.closed ?? true;
  useShortcut("reconcile", () => rc?.open(), !!rc && idle && !closed);

  const showing =
    rc?.step === "ask" || rc?.step === "enter" || rc?.step === "difference" || rc?.step === "done";
  const close = rc?.cancel;
  useEffect(() => {
    if (!showing || !close) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    };
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && wrap.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [showing, close]);

  if (!rc) return null;
  const { account } = rc;
  const bankDifference = (s: number) => s - account.cleared_balance;
  const toMode = (s: number, dont: boolean) => {
    if (dont) saveUi.mutate({ hide_reconcile_difference_dialog: true });
    rc.enterMode(s);
  };
  return (
    <>
      <span className="reconcile-anchor" ref={wrap}>
        <Tooltip
          delayed={false}
          align="end"
          content={
            <>
              <span className="acct-tip-label">Reconcile</span>
              <kbd>shift</kbd>
              <kbd>E</kbd>
            </>
          }
        >
          {(tip) => (
            <button
              type="button"
              className="acct-reconcile"
              disabled={closed || rc.step === "mode"}
              onClick={rc.open}
              {...tip}
            >
              Reconcile
            </button>
          )}
        </Tooltip>
        {rc.step === "ask" && <AskStep />}
        {rc.step === "enter" && (
          <EnterStep
            onNext={(s) => {
              if (bankDifference(s) === 0 || ui.data?.hide_reconcile_difference_dialog) {
                toMode(s, false);
              } else rc.showDifference(s);
            }}
          />
        )}
        {rc.step === "done" && (
          <div className="reconcile-popover is-done" role="dialog" aria-label="Reconcile">
            <LockCheckArt className="reconcile-art" />
            <p className="reconcile-done-title">Account reconciled</p>
            <p className="reconcile-note">Time for the reconciliation dance!</p>
          </div>
        )}
        {rc.step === "difference" && rc.statement !== undefined && (
          <DifferenceDialog
            difference={bankDifference(rc.statement)}
            onNext={(dont) => toMode(rc.statement as number, dont)}
          />
        )}
      </span>
    </>
  );
}

function AskStep() {
  const fmt = usePlanFormatter();
  const rc = useReconcile();
  if (!rc) return null;
  return (
    <div className="reconcile-popover" role="dialog" aria-label="Reconcile">
      <div className="reconcile-balance-card">
        <p className="reconcile-note">Is your current balance</p>
        <p className="reconcile-amount">{fmt.money(rc.account.cleared_balance)}?</p>
      </div>
      {rc.error && (
        <p className="reconcile-error" role="alert">
          {rc.error}
        </p>
      )}
      <div className="reconcile-buttons">
        <button type="button" className="primary" onClick={rc.goEnter}>
          No
        </button>
        <button
          type="button"
          className="primary"
          disabled={rc.pending}
          onClick={() => rc.finish(false)}
        >
          Yes
        </button>
      </div>
    </div>
  );
}

function EnterStep({ onNext }: { onNext: (statement: number) => void }) {
  const fmt = usePlanFormatter();
  const [text, setText] = useState("");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const value = parseAmountInput(fmt.typedAmount(text.replaceAll(MINUS, "-")), fmt.digits);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value !== null) onNext(value);
  };
  return (
    <form className="reconcile-popover" role="dialog" aria-label="Reconcile" onSubmit={submit}>
      <label htmlFor={id} className="reconcile-note">
        Current balance at your bank
      </label>
      <input
        ref={input}
        id={id}
        className="reconcile-input"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="reconcile-buttons is-end">
        <button type="submit" className="primary" disabled={value === null}>
          Next
        </button>
      </div>
    </form>
  );
}
