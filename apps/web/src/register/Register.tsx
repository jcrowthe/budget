import type { Account } from "@budget/schema/accounts";
import { useCallback, useEffect, useState } from "react";
import type { Open } from "./entryDraft";
import { RegisterTable } from "./RegisterTable";
import { RegisterToolbar } from "./RegisterToolbar";
import "./register.css";
import "./entry.css";

const isTyping = (t: EventTarget | null) => {
  const el = t instanceof HTMLElement ? t : null;
  return !!el && (el.closest("input,textarea,select") !== null || el.isContentEditable);
};

/** One account's register, or (without `account`) every account's: All Accounts. */
export function Register({ budgetId, account }: { budgetId: string; account?: Account }) {
  const [open, setOpen] = useState<Open>(null);
  const openAdd = useCallback((date?: string) => {
    setOpen({ mode: "add", key: Date.now() + Math.random(), date });
  }, []);

  // Shift+N adds a transaction unless the user is typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "N" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented)
        return;
      if (account?.closed) return;
      if (isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      openAdd();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openAdd, account?.closed]);

  return (
    <section className="register" aria-label="Register">
      <RegisterToolbar
        name={account?.name ?? "All Accounts"}
        onAdd={() => openAdd()}
        closed={account?.closed === true}
      />
      <RegisterTable
        budgetId={budgetId}
        account={account}
        open={open}
        onOpen={setOpen}
        onCloseEntry={() => setOpen(null)}
        onSaved={(next, date) => (next === "again" ? openAdd(date) : setOpen(null))}
      />
    </section>
  );
}
