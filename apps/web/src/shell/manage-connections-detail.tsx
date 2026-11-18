import type { BankConnection } from "@budget/schema/bank-connections";
import { bankAccountLabel, planAccountType } from "@budget/schema/bank-link";
import { BROKEN_TEXT, DELAYED_TEXT, REPAIR_TEXT } from "@budget/schema/connection-status";
import { connectionBadge, resetAvailableAt, statusLabel } from "@budget/schema/manage-connections";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAccounts } from "../api/accounts";
import { errorDetail } from "../api/bank-link";
import { renameBankConnection, setConnectionInCache } from "../api/manage-connections";
import { localToday } from "../api/today";
import { useBankSubline } from "./bank-link-accounts";
import {
  ArrowsCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  LinkIcon,
  LinkWarningIcon,
  TrashIcon,
} from "./icons";
import { ConnectionLogo } from "./manage-connections-logo";
import { usePlanFormatter } from "./plan-formats-context";

export const timeOfDay = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

type Fmt = ReturnType<typeof usePlanFormatter>;
export const syncedLine = (fmt: Fmt, iso: string | null) =>
  iso
    ? `Last synced ${fmt.date(localToday(new Date(iso)))} at ${timeOfDay(iso)}`
    : "Not synced yet";

type Relink = {
  start: () => Promise<void>;
  running: boolean;
  error: string | null;
  notice: string | null;
};

/** The reason Reset (and Repair) cannot be pressed, or null. */
export function resetReason(c: BankConnection, fmt: Fmt): string | null {
  const at = resetAvailableAt(c.last_reset_at);
  if (at) {
    return `Reset is available again on ${fmt.date(localToday(new Date(at)))} at ${timeOfDay(at)}. A bank connection can be reset once every 24 hours.`;
  }
  if (c.status === "broken") {
    return "This bank connection cannot be reset. Remove it and connect the bank again.";
  }
  return null;
}

export function ConnectionDetail({
  budgetId,
  connection,
  onBankAccount,
  onReset,
  onRemove,
  relink,
}: {
  budgetId: string;
  connection: BankConnection;
  onBankAccount: (bankId: string) => void;
  onReset: () => void;
  onRemove: () => void;
  relink: Relink;
}) {
  const fmt = usePlanFormatter();
  const qc = useQueryClient();
  const accounts = useAccounts(budgetId);
  const subline = useBankSubline();
  const [draft, setDraft] = useState(connection.nickname);
  useEffect(() => setDraft(connection.nickname), [connection.nickname]);
  const save = useMutation({
    mutationFn: () => renameBankConnection(budgetId, connection.id, draft),
    onSuccess: (c) => {
      setConnectionInCache(qc, budgetId, c);
      setDraft(c.nickname);
    },
  });
  const badge = connectionBadge(connection.status);
  const anyLinked = connection.accounts.some((a) => a.linked_account_id !== null);
  const reason = resetReason(connection, fmt);
  const waiting = resetAvailableAt(connection.last_reset_at) !== null;
  const error = save.isError ? errorDetail(save.error) : relink.error;

  return (
    <>
      <div className="account-modal-body">
        {badge ? (
          <div className="mc-banner" role="note" data-kind={badge.toLowerCase()}>
            {badge === "Delayed" ? <ClockIcon /> : <LinkWarningIcon />}
            <div className="mc-banner-text">
              <strong>{statusLabel(connection.status)}</strong>
              <span>
                {badge === "Delayed"
                  ? DELAYED_TEXT
                  : connection.status === "broken"
                    ? BROKEN_TEXT
                    : REPAIR_TEXT}
              </span>
              {badge === "Repair" && connection.status !== "broken" ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={waiting || relink.running}
                  title={waiting ? (reason ?? undefined) : undefined}
                  onClick={() => void relink.start()}
                >
                  Repair
                </button>
              ) : null}
              {connection.status === "broken" ? (
                <button type="button" className="destructive" onClick={onRemove}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <label htmlFor="mc-nickname">Nickname</label>
        <input
          id="mc-nickname"
          className="account-field"
          maxLength={100}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            save.reset();
          }}
        />
        <h3 className="mc-link-heading">
          <LinkIcon />
          {anyLinked ? "Linked in this plan" : "Not linked in this plan"}
        </h3>
        <ul className="mc-list">
          {connection.accounts.map((a) => {
            const label = bankAccountLabel(a.name, a.mask);
            const plan = accounts.data?.find((p) => p.id === a.linked_account_id);
            const sub = subline(a, plan?.type ?? planAccountType(a.type, a.subtype));
            const linked =
              a.linked_account_id !== null ? `Linked to ${plan?.name ?? "an account"}` : null;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className="mc-row mc-bank-row"
                  aria-label={label}
                  onClick={() => onBankAccount(a.id)}
                >
                  <ConnectionLogo c={connection} dot={false} />
                  <span className="mc-lines">
                    <span className="mc-line mc-name" title={label}>
                      {label}
                    </span>
                    <span className="mc-line" title={sub}>
                      {sub}
                    </span>
                    {linked ? (
                      <span className="mc-line" title={linked}>
                        {linked}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRightIcon />
                </button>
              </li>
            );
          })}
        </ul>
        <h3>Bank Connection Details</h3>
        <dl className="mc-details">
          <div>
            <dt>Bank Name</dt>
            <dd title={connection.institution_name}>{connection.institution_name}</dd>
          </div>
          <div>
            <dt>Bank Connection ID</dt>
            <dd>{connection.display_id}</dd>
          </div>
          <div>
            <dt>Import Provider</dt>
            <dd>{connection.provider}</dd>
          </div>
        </dl>
        <p className="mc-synced">{syncedLine(fmt, connection.last_synced_at)}</p>
        <div className="mc-actions">
          <button
            type="button"
            className="secondary"
            disabled={!!reason || relink.running}
            title={reason ?? undefined}
            onClick={onReset}
          >
            <ArrowsCircleIcon />
            Reset
          </button>
          <button type="button" className="destructive" onClick={onRemove}>
            <TrashIcon />
            Remove
          </button>
        </div>
        {reason ? <p className="mc-reset-note">{reason}</p> : null}
      </div>
      {error ? (
        <p className="error-bar mc-error" role="alert">
          {error}
        </p>
      ) : relink.notice ? (
        <p className="mc-notice" role="status">
          {relink.notice}
        </p>
      ) : null}
      <div className="account-modal-footer">
        <button
          type="button"
          className="primary large"
          disabled={draft.trim() === connection.nickname || save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </button>
      </div>
    </>
  );
}
