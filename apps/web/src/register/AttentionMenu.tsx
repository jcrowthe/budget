import { canReject, NEEDS_APPROVAL_LABEL } from "@budget/schema/attention";
import { bulkRefusalText } from "@budget/schema/register-selection";
import type { TransactionDetail } from "@budget/schema/transactions";
import { useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useApproveReject, useEnterPending } from "../api/transactions";
import { InfoCircleIcon } from "./icons";
import { Popover } from "./Popover";

/** The attention cell: on an unapproved row the circled "i" and its Approve / Reject menu; otherwise empty. */
export function AttentionCell({ budgetId, tx }: { budgetId: string; tx: TransactionDetail }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const mutation = useApproveReject(budgetId);
  if (tx.approved) return null;
  const rejectable = canReject(tx);

  const close = () => {
    setOpen(false);
    setError(null);
    button.current?.focus();
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

  const close = () => {
    setOpen(false);
    setError(null);
    button.current?.focus();
  };
  const enter = async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await mutation.mutateAsync({ id: tx.id });
      setOpen(false);
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
