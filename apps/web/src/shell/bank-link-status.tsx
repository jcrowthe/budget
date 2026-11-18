import type { Account } from "@budget/schema/accounts";
import { connectionLabel, type LinkStatus, linkStatus } from "@budget/schema/bank-link";
import { ClockIcon, LinkedCheckIcon, LinkWarningIcon } from "./icons";

/** The check mark of a working connection, a clock for a delay, a plain warning mark for every other status. */
export function LinkStatusIcon({ status }: { status: LinkStatus }) {
  if (status === "connected") return <LinkedCheckIcon />;
  return status === "delayed" ? <ClockIcon /> : <LinkWarningIcon />;
}

/** Icon and label of a linked account's connection (account header, edit dialog); null when not linked. */
export function LinkStatusBadge({ account, className }: { account: Account; className?: string }) {
  const s = linkStatus(account);
  if (!s) return null;
  return (
    <span className={className} data-status={s}>
      <LinkStatusIcon status={s} />
      {connectionLabel(s)}
    </span>
  );
}
