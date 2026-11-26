import { canReject, NEEDS_APPROVAL_LABEL } from "@budget/schema/attention";
import { bulkRefusalText } from "@budget/schema/register-selection";
import type { TransactionDetail } from "@budget/schema/transactions";
import { useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useApproveReject, useEnterPending } from "../api/transactions";
import { InfoCircleIcon } from "./icons";
import { Popover } from "./Popover";
import { useSelection } from "./selection";

/** The attention cell: on an unapproved row the circled "i" and its Approve / Reject menu; otherwise empty. */
export function AttentionCell({ budgetId, tx }: { budgetId: string; tx: TransactionDetail }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const mutation = useApproveReject(budgetId);
  if (tx.approved) return null;
  const rejectable = canReject(tx);

  const close = (reason?: "escape" | "tab" | "blur") => {
    setOpen(false);
    setError(null);
    if (reason !== "blur") button.current?.focus();
  };
  const choose = async (action: "approve" | "reject") => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await mutation.mutateAsync({ action, ids: [tx.id] });
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? bulkRefusalText(err.detail, () => "This transaction")
          : err instanceof Error
            ? err.message
            : "That did not work",
      );
    } finally {
      busy.current = false;
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="attention-button"
        aria-label={NEEDS_APPROVAL_LABEL}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <InfoCircleIcon />
      </button>
      {open && button.current && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the menu's buttons take the keys; this only keeps portal clicks off the row
        // biome-ignore lint/a11y/useKeyWithClickEvents: the same
        <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Popover
            anchor={button.current}
            placement="below"
            width={320}
            bodyClass="is-approval"
            align="start"
            label="Approval"
            menuKeys
            onClose={close}
          >
            <ul className="bulk-list">
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="bulk-item approval-button"
                  onClick={() => void choose("approve")}
                >
                  Approve Transaction
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="bulk-item approval-button"
                  aria-disabled={rejectable ? undefined : "true"}
                  title={rejectable ? undefined : "Only an imported transaction can be rejected"}
                  onClick={() => rejectable && void choose("reject")}
                >
                  Reject Transaction
                </button>
              </li>
            </ul>
            {error && (
              <p role="alert" className="attention-menu-error">
                {error}
              </p>
            )}
          </Popover>
        </div>
      )}
    </>
  );
}

/**
 * After Enter Now the pending row unmounts and focus would fall to <body>. Where it goes: the entered row itself
 * (which is then the selected row, so Shift+arrows continue from it), else the next (or previous) pending row's info button, else the pending header.
 */
function followingFocus(id: string): string[] {
  const rows = [...document.querySelectorAll<HTMLElement>("tr[data-pending]")];
  const at = rows.findIndex((r) => r.dataset.pending === id);
  return [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0)).reverse()]
    .map((r) => r.dataset.pending ?? "")
    .filter(Boolean);
}

async function refocus(
  pendingId: string,
  enteredId: string,
  heirs: string[],
  select: (id: string) => void,
) {
  const entered = () =>
    document.querySelector<HTMLElement>(`tr[data-tx="${CSS.escape(enteredId)}"]`);
  const target = (patient: boolean) => {
    const row = entered();
    if (row) return row;
    // The entered row may land a refetch after the pending one leaves: give it a second before falling back.
    if (patient) return null;
    for (const h of heirs) {
      const b = document.querySelector<HTMLElement>(
        `tr[data-pending="${CSS.escape(h)}"] .attention-button`,
      );
      if (b) return b;
    }
    return document.querySelector<HTMLElement>(".pending-header");
  };
  // The register refetches; wait until the pending row is gone (or, at most, 3 s), then focus.
  for (let i = 0; i < 60; i++) {
    const gone = !document.querySelector(`tr[data-pending="${CSS.escape(pendingId)}"]`);
    const lost = !document.activeElement || document.activeElement === document.body;
    if (gone && lost) {
      const t = target(i < 20);
      if (t) {
        if (t.dataset.tx === enteredId) select(enteredId);
        t.focus();
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** EXF-466: the circled "i" of a pending bank transaction: its one menu item, Enter Now. */
export function PendingAttentionCell({
  budgetId,
  tx,
}: {
  budgetId: string;
  tx: TransactionDetail;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const mutation = useEnterPending(budgetId);
  const { pick } = useSelection();

  const close = (reason?: "escape" | "tab" | "blur") => {
    setOpen(false);
    setError(null);
    if (reason !== "blur") button.current?.focus();
  };
  const enter = async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    const heirs = followingFocus(tx.id);
    try {
      const entered = await mutation.mutateAsync({ id: tx.id });
      setOpen(false);
      void refocus(tx.id, entered.id, heirs, (id) => pick("real", id, "only"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
    } finally {
      busy.current = false;
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="attention-button"
        aria-label="This is a pending bank transaction"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <InfoCircleIcon />
      </button>
      {open && button.current && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the menu's button takes the keys; this only keeps portal clicks off the row
        // biome-ignore lint/a11y/useKeyWithClickEvents: the same
        <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Popover
            anchor={button.current}
            placement="below"
            width={320}
            bodyClass="is-approval"
            align="start"
            label="Pending transaction"
            menuKeys
            onClose={close}
          >
            <ul className="bulk-list">
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="bulk-item approval-button"
                  onClick={() => void enter()}
                >
                  Enter Now
                </button>
              </li>
            </ul>
            <p className="pending-menu-hint">
              Adds it to the register as uncleared. When the bank posts it, the two are matched.
            </p>
            {error && (
              <p role="alert" className="attention-menu-error">
                {error}
              </p>
            )}
          </Popover>
        </div>
      )}
    </>
  );
}
