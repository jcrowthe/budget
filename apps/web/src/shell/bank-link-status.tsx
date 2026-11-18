import type { Account } from "@budget/schema/accounts";
import { type ShownStatus, shownLabel, shownStatus } from "@budget/schema/connection-status";
import { DiamondAlertIcon } from "./connection-status-icon";
import { ClockIcon, LinkedCheckIcon, LinkWarningIcon } from "./icons";

/** The check mark of a working connection, a clock for a delay, a diamond for a link the bank no longer lists, a plain warning mark for every other status. */
export function LinkStatusIcon({ status }: { status: ShownStatus }) {
  if (status === "connected") return <LinkedCheckIcon />;
  if (status === "not_found") return <DiamondAlertIcon />;
  return status === "delayed" ? <ClockIcon /> : <LinkWarningIcon />;
}

/** Icon and label of a linked account's connection (account header, edit dialog); null when not linked. */
export function LinkStatusBadge({ account, className }: { account: Account; className?: string }) {
  const s = shownStatus(account);
  if (!s) return null;
  const label = shownLabel(s);
  return (
    <span className={className} data-status={s} title={label}>
      <LinkStatusIcon status={s} />
      <span className="link-status-label">{label}</span>
    </span>
  );
}
