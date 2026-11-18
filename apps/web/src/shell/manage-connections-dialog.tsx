import type { BankConnection } from "@budget/schema/bank-connections";
import { bankAccountLabel } from "@budget/schema/bank-link";
import {
  accountCountLabel,
  CONNECTION_GROUPS,
  connectionBadge,
  connectionGroup,
  statusLabel,
} from "@budget/schema/manage-connections";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { UnlinkAccountDialog } from "../account/link-account-unlink";
import { useAccounts } from "../api/accounts";
import { errorDetail, invalidateBankLink, useBankConnections } from "../api/bank-link";
import { useBudgets } from "../api/budgets";
import { removeBankConnection } from "../api/manage-connections";
import { AddAccountDialog } from "./AddAccountDialog";
import { BankLinkAccounts } from "./bank-link-accounts";
import {
  BankIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  LinkWarningIcon,
} from "./icons";
import { BankAccountOptions, LinkExistingAccount } from "./manage-connections-bank-account";
import { ConfirmConnectionDialog } from "./manage-connections-confirm";
import { ConnectionDetail } from "./manage-connections-detail";
import { ConnectionLogo } from "./manage-connections-logo";
import { useConnectionRelink } from "./manage-connections-relink";
import { usePlanFormatter } from "./plan-formats-context";
import "./manage-connections.css";

type View =
  | { v: "list" }
  | { v: "add" }
  | { v: "detail"; id: string }
  | { v: "bank"; id: string; bankId: string }
  | { v: "link"; id: string; bankId: string }
  | { v: "new"; id: string; bankId: string }
  | { v: "unlink"; id: string; bankId: string }
  | { v: "reset"; id: string }
  | { v: "remove"; id: string };

const LIST_TITLE = "Manage Bank Connections";

/** Manage Bank Connections (EXF-460): the list, a connection's detail and its bank accounts' options. */
export function ManageConnectionsDialog({
  budgetId,
  onClose,
  initialConnectionId,
}: {
  budgetId: string | null;
  onClose: () => void;
  /** Opens on this connection's detail instead of the list (Back and Escape still go to the list). */
  initialConnectionId?: string;
}) {
  if (!budgetId) return null;
  return <Host budgetId={budgetId} onClose={onClose} initialConnectionId={initialConnectionId} />;
}

function ConnectionRow({ c, onOpen }: { c: BankConnection; onOpen: () => void }) {
  const badge = connectionBadge(c.status);
  const count = accountCountLabel(c.accounts.length);
  const id = `ID: ${c.display_id}`;
  return (
    <li>
      <button type="button" className="mc-row" aria-label={c.nickname} onClick={onOpen}>
        <ConnectionLogo c={c} />
        <span className="mc-lines">
          <span className="mc-line mc-name" title={c.nickname}>
            {c.nickname}
          </span>
          <span className="mc-line" title={count}>
            {count}
          </span>
          <span className="mc-line" title={id}>
            {id}
          </span>
        </span>
        {badge ? (
          <span className="mc-badge" data-kind={badge.toLowerCase()}>
            {badge === "Delayed" ? <ClockIcon /> : <LinkWarningIcon />}
            {badge}
          </span>
        ) : null}
        <ChevronRightIcon />
      </button>
    </li>
  );
}

function Host({
  budgetId,
  onClose,
  initialConnectionId,
}: {
  budgetId: string;
  onClose: () => void;
  initialConnectionId?: string;
}) {
  const qc = useQueryClient();
  const fmt = usePlanFormatter();
  const connections = useBankConnections(budgetId);
  const accounts = useAccounts(budgetId);
  const sandbox = useBudgets().data?.find((b) => b.id === budgetId)?.bank_environment === "sandbox";
  const [view, setView] = useState<View>(
    initialConnectionId ? { v: "detail", id: initialConnectionId } : { v: "list" },
  );
  const linking = useRef(false);
  const id = "id" in view ? view.id : "";
  const relink = useConnectionRelink(budgetId, id, (open) => {
    linking.current = open;
  });
  // A Reset or Repair message belongs to the connection it came from.
  const clearRelinkError = relink.clearError;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear only when the viewed connection changes
  useEffect(() => clearRelinkError(), [id]);
  const list = connections.data ?? [];
  const connection = list.find((c) => c.id === id);
  const bank =
    "bankId" in view ? connection?.accounts.find((a) => a.id === view.bankId) : undefined;

  const toList = () => {
    void qc.invalidateQueries({ queryKey: ["bank-connections", budgetId] });
    setView({ v: "list" });
  };
  const toDetail = (cid: string) => setView({ v: "detail", id: cid });

  // A viewed connection that disappears (removed) falls back to the list.
  useEffect(() => {
    if (view.v === "list" || view.v === "add" || !connections.isSuccess) return;
    if (!connection || ("bankId" in view && !bank)) setView({ v: "list" });
  }, [view, connection, bank, connections.isSuccess]);

  const escRef = useRef(() => {});
  escRef.current = () => {
    if (linking.current) return;
    switch (view.v) {
      case "list":
        onClose();
        break;
      case "detail":
        setView({ v: "list" });
        break;
      case "bank":
        toDetail(view.id);
        break;
      case "link":
      case "new":
        setView({ v: "bank", id: view.id, bankId: view.bankId });
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (view.v === "add") {
    return <AddAccountDialog variant="connections" onBack={toList} onClose={toList} />;
  }
  if (view.v === "unlink" && connection && bank) {
    const plan = accounts.data?.find((a) => a.id === bank.linked_account_id);
    if (plan) {
      return (
        <UnlinkAccountDialog
          budgetId={budgetId}
          account={plan}
          onCancel={() => setView({ v: "bank", id: connection.id, bankId: bank.id })}
          onUnlinked={() => toDetail(connection.id)}
        />
      );
    }
  }
  if (view.v === "reset" && connection) {
    return (
      <ConfirmConnectionDialog
        title="Reset Bank Connection"
        text={`Reset signs in to ${connection.institution_name} again for this connection. Its accounts, their links and their transactions stay. After a reset, Reset is not available for 24 hours.`}
        confirmLabel="Reset"
        onConfirm={async () => undefined}
        onCancel={() => toDetail(connection.id)}
        onDone={() => {
          toDetail(connection.id);
          void relink.start();
        }}
      />
    );
  }
  if (view.v === "remove" && connection) {
    return (
      <ConfirmConnectionDialog
        title="Remove Bank Connection"
        text="This will unlink every account linked to this connection. Their transactions and the accounts themselves stay."
        confirmLabel="Remove"
        destructive
        onConfirm={() => removeBankConnection(budgetId, connection.id)}
        onCancel={() => toDetail(connection.id)}
        onDone={() => {
          invalidateBankLink(qc, budgetId);
          setView({ v: "list" });
        }}
      />
    );
  }

  let title = LIST_TITLE;
  let subtitle: string | null = null;
  let back: (() => void) | null = null;
  if (view.v === "detail" && connection) {
    title = connection.nickname;
    subtitle = statusLabel(connection.status);
    back = () => setView({ v: "list" });
  } else if (view.v === "bank" && connection && bank) {
    title = bankAccountLabel(bank.name, bank.mask);
    back = () => toDetail(connection.id);
  } else if (view.v === "link" && bank) {
    title = "Link to an Existing Account";
    back = () => setView({ v: "bank", id, bankId: bank.id });
  } else if (view.v === "new" && bank) {
    title = "Account Details";
    back = () => setView({ v: "bank", id, bankId: bank.id });
  }
  const shown = view.v === "list" || (connection && (view.v === "detail" || bank));

  return (
    <div className="dialog-backdrop top">
      <div
        className="dialog modal account-modal manage-connections"
        role="dialog"
        aria-label={title}
      >
        <div className="dialog-head">
          {back ? (
            <button type="button" className="icon-button back" aria-label="Back" onClick={back}>
              <ChevronLeftIcon />
            </button>
          ) : null}
          <div className="mc-title">
            <h2 title={title}>{title}</h2>
            {subtitle ? <p className="mc-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {view.v === "list" || !shown ? (
          <>
            <div className="account-modal-body">
              {sandbox ? (
                <span className="env-pill" title="Plaid Sandbox: test banks only">
                  Sandbox
                </span>
              ) : null}
              {connections.isError ? (
                <p className="error-bar mc-error" role="alert">
                  {errorDetail(connections.error)}
                </p>
              ) : null}
              {connections.isSuccess && list.length === 0 ? (
                <p className="mc-empty">No bank connections yet.</p>
              ) : null}
              {CONNECTION_GROUPS.map((g) => {
                const rows = list.filter((c) => connectionGroup(c.status) === g.id);
                if (rows.length === 0) return null;
                return (
                  <section key={g.id}>
                    <h3>{g.heading}</h3>
                    <ul className="mc-list">
                      {rows.map((c) => (
                        <ConnectionRow
                          key={c.id}
                          c={c}
                          onOpen={() => setView({ v: "detail", id: c.id })}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
            <div className="account-modal-footer">
              <button type="button" className="primary large" onClick={() => setView({ v: "add" })}>
                Add a New Bank Connection
              </button>
            </div>
          </>
        ) : null}
        {view.v === "detail" && connection ? (
          <ConnectionDetail
            budgetId={budgetId}
            connection={connection}
            onBankAccount={(bankId) => setView({ v: "bank", id: connection.id, bankId })}
            onReset={() => setView({ v: "reset", id: connection.id })}
            onRemove={() => setView({ v: "remove", id: connection.id })}
            relink={relink}
          />
        ) : null}
        {view.v === "bank" && connection && bank ? (
          <BankAccountOptions
            budgetId={budgetId}
            connection={connection}
            bank={bank}
            onLinkExisting={() => setView({ v: "link", id, bankId: bank.id })}
            onAddNew={() => setView({ v: "new", id, bankId: bank.id })}
            onUnlink={() => setView({ v: "unlink", id, bankId: bank.id })}
          />
        ) : null}
        {view.v === "link" && bank ? (
          <LinkExistingAccount budgetId={budgetId} bank={bank} onLinked={() => toDetail(id)} />
        ) : null}
        {view.v === "new" && connection && bank ? (
          <BankLinkAccounts
            budgetId={budgetId}
            connection={{ ...connection, accounts: [bank] }}
            sandbox={sandbox}
            screen="edit"
            onScreen={() => undefined}
            onDone={() => toDetail(id)}
            single
          />
        ) : null}
      </div>
    </div>
  );
}
