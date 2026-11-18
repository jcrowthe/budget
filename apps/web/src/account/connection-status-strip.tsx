import type { Account } from "@budget/schema/accounts";
import { shownStatus, stripFor } from "@budget/schema/connection-status";
import { useEffect, useState } from "react";
import { useAccountConnection } from "../api/bank-link";
import { DiamondAlertIcon, WarningTriangleIcon } from "../shell/connection-status-icon";
import { ClockIcon } from "../shell/icons";
import { resetReason } from "../shell/manage-connections-detail";
import { ManageConnectionsDialog } from "../shell/manage-connections-dialog";
import { useConnectionRelink } from "../shell/manage-connections-relink";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { LinkAccountDialog } from "./link-account-dialog";
import { UnlinkAccountDialog } from "./link-account-unlink";
import "./connection-status-strip.css";

const noop = () => undefined;

/** The linked account's strip: Repair when the bank needs a sign-in, a way to Remove when broken, a line for a long delay. */
export function ConnectionStrip({ account }: { account: Account }) {
  const s = shownStatus(account);
  const fmt = usePlanFormatter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const [managing, setManaging] = useState(false);
  const [dialog, setDialog] = useState<"link" | "unlink" | null>(null);
  const { connection, isError } = useAccountConnection(
    account.budget_id,
    account.bank_account_id,
    account.linked && !account.closed && s !== null && s !== "connected" && s !== "not_found",
  );
  const relink = useConnectionRelink(account.budget_id, connection?.id ?? "", noop);
  const strip = stripFor(account, connection?.created_at, now);
  if (!strip) return null;
  const reason = connection
    ? resetReason(connection, fmt)
    : isError
      ? "Bank connections could not be loaded."
      : null;
  const disabled = !connection || relink.running || reason !== null;
  const act = () =>
    strip.kind === "repair"
      ? void relink.start()
      : strip.kind === "not_found"
        ? setDialog("link")
        : setManaging(true);
  const actionable =
    strip.kind === "repair"
      ? !disabled
      : strip.kind === "not_found" || (strip.kind === "broken" && !!connection);
  return (
    <>
      {/* A click anywhere on the strip runs its button's action; the button stays the keyboard target. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the strip's button is the keyboard and screen reader target */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the strip's button is the keyboard and screen reader target */}
      <div
        className="acct-connection-strip"
        data-kind={strip.kind}
        data-actionable={actionable}
        role="note"
        onClick={(e) => {
          if (actionable && !(e.target as HTMLElement).closest("button")) act();
        }}
      >
        {strip.kind === "delayed" ? (
          <ClockIcon width={16} height={16} />
        ) : strip.kind === "not_found" ? (
          <DiamondAlertIcon width={16} height={16} />
        ) : (
          <WarningTriangleIcon width={16} height={16} />
        )}
        <span className="acct-connection-text" title={strip.text}>
          {strip.text}
        </span>
        {strip.kind === "repair" ? (
          <span title={reason ?? undefined} className="acct-connection-action">
            <button
              type="button"
              className="acct-connection-button"
              disabled={disabled}
              aria-busy={relink.running}
              onClick={() => void relink.start()}
            >
              Repair
            </button>
          </span>
        ) : null}
        {strip.kind === "not_found" ? (
          <>
            <button
              type="button"
              className="acct-connection-button"
              onClick={() => setDialog("link")}
            >
              Relink
            </button>
            <button
              type="button"
              className="acct-connection-button secondary"
              onClick={() => setDialog("unlink")}
            >
              Unlink
            </button>
          </>
        ) : null}
        {strip.kind === "broken" ? (
          <button
            type="button"
            className="acct-connection-button"
            disabled={!connection}
            title={!connection && isError ? (reason ?? undefined) : undefined}
            onClick={() => setManaging(true)}
          >
            Open Bank Connections
          </button>
        ) : null}
      </div>
      {relink.error ? (
        <p className="error-bar acct-connection-error" role="alert">
          {relink.error}
        </p>
      ) : relink.notice ? (
        <p className="acct-connection-notice" role="status">
          {relink.notice}
        </p>
      ) : null}
      {dialog === "link" ? (
        <LinkAccountDialog
          budgetId={account.budget_id}
          account={account}
          onBack={() => setDialog(null)}
          onLinked={() => setDialog(null)}
        />
      ) : null}
      {dialog === "unlink" ? (
        <UnlinkAccountDialog
          budgetId={account.budget_id}
          account={account}
          onCancel={() => setDialog(null)}
          onUnlinked={() => setDialog(null)}
        />
      ) : null}
      {managing && connection ? (
        <ManageConnectionsDialog
          budgetId={account.budget_id}
          initialConnectionId={connection.id}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </>
  );
}
