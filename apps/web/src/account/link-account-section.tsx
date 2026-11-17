import type { Account } from "@budget/schema/accounts";
import { bankAccountLabel, syncLine } from "@budget/schema/bank-link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  errorDetail,
  invalidateBankLink,
  syncConnection,
  useBankConnections,
} from "../api/bank-link";
import { localToday } from "../api/today";
import { LinkStatusBadge } from "../shell/bank-link-status";
import { usePlanFormatter } from "../shell/plan-formats-context";

const NOT_FOUND = "Bank connection not found";

/** "Bank Connection" in Edit Account: Link Account for an open unlinked account; for a linked one, its status, Sync Now and Unlink. */
export function BankConnectionSection({
  budgetId,
  account,
  onLink,
  onUnlink,
}: {
  budgetId: string;
  account: Account;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const fmt = usePlanFormatter();
  const qc = useQueryClient();
  const connections = useBankConnections(budgetId, account.linked);
  const connection = connections.data?.find((c) =>
    c.accounts.some((a) => a.id === account.bank_account_id),
  );
  const bank = connection?.accounts.find((a) => a.id === account.bank_account_id);
  const sync = useMutation({
    mutationFn: () => syncConnection(budgetId, connection?.id ?? ""),
    onSettled: () => invalidateBankLink(qc, budgetId),
  });

  const resultLine = useRef<HTMLParagraphElement>(null);
  const done = sync.isSuccess || sync.isError;
  // The result line appears below the buttons: bring it into view when the dialog is short (EXF-773).
  useEffect(() => {
    if (done) resultLine.current?.scrollIntoView({ block: "nearest" });
  }, [done]);

  if (account.closed || (!account.linked && account.type === "cash")) return null;

  if (!account.linked) {
    return (
      <>
        <hr />
        <h3>Bank Connection</h3>
        <p className="helper link-helper">
          Not linked. Link this account to import its transactions from your bank.
        </p>
        <button type="button" className="secondary link-button-row" onClick={onLink}>
          Link Account
        </button>
      </>
    );
  }

  const where =
    connection && bank
      ? `${connection.nickname} · ${bankAccountLabel(bank.name, bank.mask)}`
      : null;
  const last = account.last_synced_at
    ? `Last synced ${fmt.date(localToday(new Date(account.last_synced_at)))}`
    : "Not synced yet";
  return (
    <>
      <hr />
      <h3>Bank Connection</h3>
      <LinkStatusBadge account={account} className="edit-account-link-status" />
      {where ? (
        <p className="edit-account-link-line" title={where}>
          {where}
        </p>
      ) : null}
      <p className="edit-account-link-line">{last}</p>
      <div className="edit-account-link-buttons">
        <button
          type="button"
          className="secondary"
          disabled={!connection || sync.isPending}
          title={connection ? undefined : NOT_FOUND}
          onClick={() => sync.mutate()}
        >
          <span className="sync-label">
            <span aria-hidden={sync.isPending}>Sync Now</span>
            <span aria-hidden={!sync.isPending}>Syncing…</span>
          </span>
        </button>
        <button type="button" className="secondary" onClick={onUnlink}>
          Unlink Account
        </button>
      </div>
      {sync.isSuccess ? (
        <p ref={resultLine} className="sync-line" role="status">
          {syncLine(sync.data)}
        </p>
      ) : null}
      {sync.isError ? (
        <p ref={resultLine} className="sync-line is-error" role="status">
          {errorDetail(sync.error)}
        </p>
      ) : null}
    </>
  );
}
