import type { Account } from "@budget/schema/accounts";
import { useCallback, useEffect, useState } from "react";
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
