import type { Account } from "@budget/schema/accounts";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { useReconcileAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { localToday } from "../api/today";

export type ReconcileStep = "idle" | "ask" | "enter" | "done" | "difference" | "mode";

export type Reconcile = {
  account: Account;
  step: ReconcileStep;
  /** The bank balance the person typed (milliunits), from the Difference step on. */
  statement: number | undefined;
  pending: boolean;
  /** The last request's refusal, shown in the bar or the popover. */
  error: string | null;
  /** Idle → the "Is your current balance" popover. */
  open: () => void;
  /** Leaves whatever step is showing; nothing is written. */
  cancel: () => void;
  goEnter: () => void;
  showDifference: (statement: number) => void;
  enterMode: (statement: number) => void;
  /** Reconciles with the bank balance of the step (the cleared balance on Yes). */
  finish: (createAdjustment: boolean) => void;
};

const Ctx = createContext<Reconcile | null>(null);

/** `null` outside a provider (All Accounts). */
export const useReconcile = (): Reconcile | null => useContext(Ctx);

/**
 * One account's reconcile flow. It holds the step and the bank balance and fetches nothing: the live difference
 * reads the account the page already holds.
 */
export function ReconcileProvider({
  account,
  children,
}: {
  account: Account;
  children: ReactNode;
}) {
  const [step, setStep] = useState<ReconcileStep>("idle");
  const [statement, setStatement] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const run = useReconcileAccount(account.budget_id, account.id);

  const open = useCallback(() => {
    setError(null);
    setStep("ask");
  }, []);
  const cancel = useCallback(() => {
    setError(null);
    setStatement(undefined);
    setStep("idle");
  }, []);
  const showDifference = useCallback((s: number) => {
    setStatement(s);
    setStep("difference");
  }, []);
  const enterMode = useCallback((s: number) => {
    setError(null);
    setStatement(s);
    setStep("mode");
  }, []);
  const finish = useCallback(
    (createAdjustment: boolean) => {
      const yes = step === "ask";
      const bank = yes ? account.cleared_balance : statement;
      if (bank === undefined || run.isPending) return;
      setError(null);
      run.mutate(
        {
          statement_balance: bank,
          create_adjustment: createAdjustment,
          cleared_balance: account.cleared_balance,
          today: localToday(),
        },
        {
          onSuccess: () => {
            setStatement(undefined);
            // A cancel while the request ran already went to idle: only the ask step moves on to "done".
            setStep((cur) => (yes ? (cur === "ask" ? "done" : cur) : "idle"));
          },
          onError: (e) => {
            // The plan's queries refetch: the bar shows the new difference and keeps its step.
            setError(
              e instanceof ApiError && e.errorName === "reconcile_changed"
                ? "The cleared balance changed. Check the new difference and try again."
                : `Couldn't reconcile the account. ${e.message}`,
            );
          },
        },
      );
    },
    [step, statement, account.cleared_balance, run],
  );

  const value = useMemo<Reconcile>(
    () => ({
      account,
      step,
      statement,
      pending: run.isPending,
      error,
      open,
      cancel,
      goEnter: () => setStep("enter"),
      showDifference,
      enterMode,
      finish,
    }),
    [
      account,
      step,
      statement,
      run.isPending,
      error,
      open,
      cancel,
      showDifference,
      enterMode,
      finish,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
