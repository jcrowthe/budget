import type { Account } from "@budget/schema/accounts";
import {
  placeStatusPopup,
  popupFor,
  shownLabel,
  shownStatus,
} from "@budget/schema/connection-status";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { LinkAccountDialog } from "../account/link-account-dialog";
import { UnlinkAccountDialog } from "../account/link-account-unlink";
import { useAccountConnection } from "../api/bank-link";
import { LinkStatusIcon } from "./bank-link-status";
import { DiamondAlertIcon, WarningTriangleIcon } from "./connection-status-icon";
import { resetReason } from "./manage-connections-detail";
import { useConnectionRelink } from "./manage-connections-relink";
import { usePlanFormatter } from "./plan-formats-context";
import "./connection-status.css";

const noop = () => undefined;
const CLOSE_DELAY_MS = 200;

/**
 * A linked account's connection mark in the sidebar, with the popup of its status and its action. It opens
 * on hover and on focus, stays open while the pointer is on it, closes on Escape (focus back on the mark),
 * on a click outside, on a scroll of the sidebar and on a resize. A click on the mark keeps it open.
 */
export function ConnectionStatusMark({
  budgetId,
  account,
}: {
  budgetId: string;
  account: Account;
}) {
  const s = shownStatus(account);
  const fmt = usePlanFormatter();
  const popupId = useId();
  const markRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dialog, setDialog] = useState<"link" | "unlink" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pos, setPos] = useState<ReturnType<typeof placeStatusPopup> | null>(null);
  const { connection } = useAccountConnection(
    budgetId,
    account.bank_account_id,
    open && s === "login_required",
  );
  const relink = useConnectionRelink(budgetId, connection?.id ?? "", noop);
  const held = relink.running || !!relink.error || !!relink.notice;
  const sticky = pinned || held;
  const stickyRef = useRef(held);
  // A pin survives the pointer leaving; only a running Repair or a held message survives a scroll or a resize.
  stickyRef.current = held;

  const cancelClose = useCallback(() => window.clearTimeout(timer.current), []);
  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    setNow(Date.now());
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
    setPos(null);
  }, []);
  const clearMessages = relink.clearError;
  const closeAndReset = useCallback(() => {
    close();
    clearMessages();
  }, [close, clearMessages]);
  const closeSoon = () => {
    if (sticky) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(close, CLOSE_DELAY_MS);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open || !markRef.current || !popupRef.current) return;
    const size = popupRef.current.getBoundingClientRect();
    setPos(
      placeStatusPopup(
        markRef.current.getBoundingClientRect(),
        { width: size.width, height: size.height },
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (markRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      closeAndReset();
    };
    // A running Repair or a message keeps the popup open; only the sidebar's own scroll closes it.
    const away = (e: Event) => {
      if (stickyRef.current) return;
      if (e.type === "scroll") {
        const t = e.target as Element | Document;
        if (!(t instanceof Element) || !t.contains(markRef.current)) return;
      }
      closeAndReset();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open, closeAndReset]);

  if (!s) return null;
  const popup = popupFor(s, account.last_synced_at, now);
  const reason = connection ? resetReason(connection, fmt) : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    closeAndReset();
    markRef.current?.focus();
  };
  const onBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && (markRef.current?.contains(to) || popupRef.current?.contains(to))) return;
    if (!sticky) close();
  };

  return (
    <>
      <button
        ref={markRef}
        type="button"
        className="nav-link-status"
        data-status={s}
        aria-label={shownLabel(s)}
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        onPointerEnter={show}
        onPointerLeave={closeSoon}
        onFocus={show}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (open && pinned) closeAndReset();
          else {
            show();
            setPinned(true);
          }
        }}
      >
        {s === "login_required" || s === "broken" ? (
          <WarningTriangleIcon width={12} height={12} />
        ) : s === "not_found" ? (
          <DiamondAlertIcon width={12} height={12} />
        ) : (
          <LinkStatusIcon status={s} />
        )}
      </button>
      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: hover and Escape keep a non-modal popup open or close it
        <div
          ref={popupRef}
          id={popupId}
          role="dialog"
          aria-label={popup.title}
          className="status-popup"
          style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
          onPointerEnter={cancelClose}
          onPointerLeave={closeSoon}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        >
          <span
            className="status-popup-arrow"
            data-side={pos?.side ?? "right"}
            style={{ top: pos?.arrowTop ?? 0 }}
          />
          <strong>{popup.title}</strong>
          <p className="status-popup-line">{popup.line}</p>
          {popup.details ? <p className="status-popup-details">{popup.details}</p> : null}
          {popup.action === "repair" ? (
            <span className="status-popup-action" title={reason ?? undefined}>
              <button
                type="button"
                className="status-popup-button"
                disabled={!connection || relink.running || reason !== null}
                aria-busy={relink.running}
                onClick={() => void relink.start()}
              >
                Repair
              </button>
            </span>
          ) : null}
          {popup.action === "relink" ? (
            <span className="status-popup-action status-popup-actions">
              <button
                type="button"
                className="status-popup-button"
                onClick={() => {
                  closeAndReset();
                  setDialog("link");
                }}
              >
                Relink
              </button>
              <button
                type="button"
                className="status-popup-button secondary"
                onClick={() => {
                  closeAndReset();
                  setDialog("unlink");
                }}
              >
                Unlink
              </button>
            </span>
          ) : null}
          {relink.error ? (
            <p className="status-popup-error" role="alert">
              {relink.error}
            </p>
          ) : relink.notice ? (
            <p className="status-popup-notice" role="status">
              {relink.notice}
            </p>
          ) : null}
        </div>
      ) : null}
      {dialog === "link" ? (
        <LinkAccountDialog
          budgetId={budgetId}
          account={account}
          onBack={() => setDialog(null)}
          onLinked={() => setDialog(null)}
        />
      ) : null}
      {dialog === "unlink" ? (
        <UnlinkAccountDialog
          budgetId={budgetId}
          account={account}
          onCancel={() => setDialog(null)}
          onUnlinked={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
