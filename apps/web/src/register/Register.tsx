import type { Account } from "@budget/schema/accounts";
import { isCredit } from "@budget/schema/card-payments";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { usePaymentAvailable } from "../account/usePaymentAvailable";
import { ActionBar } from "./ActionBar";
import type { Open } from "./entryDraft";
import { useOpenAccounts } from "./openAccounts";
import { RegisterTable } from "./RegisterTable";
import { RegisterToolbar } from "./RegisterToolbar";
import { useSelection } from "./selection";
import "./register.css";
import "./entry.css";

const isTyping = (t: EventTarget | null) => {
  const el = t instanceof HTMLElement ? t : null;
  return !!el && (el.closest("input,textarea,select") !== null || el.isContentEditable);
};

/** One account's register, or (without `account`) every account's: All Accounts. */
export function Register({ budgetId, account }: { budgetId: string; account?: Account }) {
  const [open, setOpen] = useState<Open>(null);
  const { selected, scheduled } = useSelection();
  const { openAccounts, loaded } = useOpenAccounts(budgetId);
  // A closed account, or All Accounts with no open account, takes no new transaction.
  const closed = account ? account.closed : loaded && openAccounts.length === 0;
  const openAdd = useCallback((date?: string) => {
    setOpen({ mode: "add", key: Date.now() + Math.random(), date });
  }, []);

  // EXF-539: Record Payment opens a new row dated today with Inflow set to the payment Available (D2).
  const credit = !!account && isCredit(account.type);
  const pay = usePaymentAvailable(budgetId, account?.id ?? "", credit);
  const openPayment = () =>
    setOpen({
      mode: "add",
      key: Date.now() + Math.random(),
      payment: { inflow: pay.available ?? null },
    });
  // `?record-payment` (the Plan page's button) opens that row once, then drops the parameter (D7).
  const [params, setParams] = useSearchParams();
  const wantsPayment = params.has("record-payment");
  const handled = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the account and its month are there
  useEffect(() => {
    if (!wantsPayment || handled.current) return;
    // All Accounts has no account: only drop the parameter.
    if (account && credit && !account.closed) {
      if (!pay.settled) return;
      openPayment();
    }
    handled.current = true;
    const next = new URLSearchParams(params);
    next.delete("record-payment");
    setParams(next, { replace: true });
  }, [wantsPayment, account, credit, pay.settled]);

  // Shift+N adds a transaction unless the user is typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "N" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented)
        return;
      if (closed) return;
      if (isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      openAdd();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openAdd, closed]);

  return (
    <section
      className={`register${selected.size > 0 || scheduled.size > 0 ? " has-actionbar" : ""}`}
      aria-label="Register"
    >
      <RegisterToolbar
        name={account?.name ?? "All Accounts"}
        onAdd={() => openAdd()}
        closed={closed}
        onRecordPayment={credit ? openPayment : undefined}
        paymentDisabled={!account || account.closed || !pay.settled}
      />
      <RegisterTable
        budgetId={budgetId}
        account={account}
        open={open}
        onOpen={setOpen}
        onCloseEntry={() => setOpen(null)}
        onSaved={(next, date) => (next === "again" ? openAdd(date) : setOpen(null))}
      />
      <ActionBar
        budgetId={budgetId}
        account={account}
        entryOpen={open !== null}
        onCategorizeOne={(id) =>
          setOpen({ mode: "edit", id, focus: "category", openCategory: true })
        }
      />
    </section>
  );
}
