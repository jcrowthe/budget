// Pure rules of the bank link screens (EXF-461): what a bank account becomes in the plan, its labels,
// the sync line and when a plan's linked accounts are due. Shared by the Worker (which makes the accounts)
// and the web app (which proposes them), so the screen shows what the server will make.
import type { AccountType } from "./accounts";
import type { SyncResult } from "./bank-connections";
import { DUE_AFTER_MS } from "./plaid-import";

/** Plaid (type, subtype) → plan account type; see docs/account-links-design.md. */
export function planAccountType(type: string, subtype: string | null): AccountType {
  const t = type.toLowerCase();
  const s = (subtype ?? "").toLowerCase();
  if (t === "depository") {
    if (s === "savings" || s === "money market" || s === "cd" || s === "hsa") return "savings";
    return "checking";
  }
  if (t === "credit") return "creditCard";
  if (t === "loan") {
    if (s === "mortgage") return "mortgage";
    if (s === "auto") return "autoLoan";
    if (s === "student") return "studentLoan";
    return "personalLoan";
  }
  return "otherAsset";
}

/** The bank account's name, or (when the bank's is blank) its type and mask, so the name is never empty. */
export function defaultAccountName(bank: {
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
}): string {
  const name = bank.name.trim().slice(0, 100);
  if (name !== "") return name;
  return (
    `${bank.subtype ?? bank.type}${bank.mask ? ` ${bank.mask}` : ""}`.trim().slice(0, 100) ||
    "Account"
  );
}

/** A bank account's balance (milliunits, the bank's sign) as the plan stores it: owed balances are negative; null → 0; never -0. */
export function planBalanceOf(plaidType: string, milli: number | null): number {
  if (milli === null || milli === 0) return 0;
  const t = plaidType.toLowerCase();
  return t === "credit" || t === "loan" ? -milli : milli;
}

/** "<name> – <mask>" (U+2013), the name alone when the bank gives no mask. */
export function bankAccountLabel(name: string, mask: string | null): string {
  return mask ? `${name} – ${mask}` : name;
}

export function addAccountsLabel(n: number): string {
  return `Add ${n} ${n === 1 ? "Account" : "Accounts"}`;
}

export type LinkStatus = "connected" | "delayed" | "login_required" | "broken";

/** A linked account's status; a linked account whose status is unknown counts as needing repair. */
export function linkStatus(a: {
  linked: boolean;
  connection_status: LinkStatus | null;
}): LinkStatus | null {
  if (!a.linked) return null;
  return a.connection_status ?? "broken";
}

export function connectionLabel(s: LinkStatus | "not_set_up"): string {
  switch (s) {
    case "connected":
      return "Connected";
    case "delayed":
      return "Imports Delayed";
    case "login_required":
      return "Connection Repair Needed";
    case "broken":
      return "Connection Lost";
    case "not_set_up":
      return "Bank connections are not set up";
  }
}

/** The one line shown after Sync Now, from the answer's counts. */
export function syncLine(
  r: Pick<
    SyncResult,
    "status" | "added" | "matched" | "modified" | "removed" | "skipped" | "has_more"
  >,
): string {
  if (r.status === "not_set_up") return "Bank connections are not set up.";
  const head = r.status === "connected" ? "Synced" : connectionLabel(r.status);
  const parts = (
    [
      [r.added, "new"],
      [r.matched, "matched"],
      [r.modified, "updated"],
      [r.removed, "removed"],
      [r.skipped, "skipped"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}`);
  const line = `${head}: ${parts.length > 0 ? parts.join(", ") : "nothing new"}.`;
  return r.has_more ? `${line} More to import: press Sync Now again.` : line;
}

/** True when an open linked account was never synced or last synced six hours ago or more. */
export function planSyncDue(
  accounts: { linked: boolean; closed: boolean; last_synced_at: string | null }[],
  nowMs: number,
): boolean {
  return accounts.some((a) => {
    if (!a.linked || a.closed) return false;
    if (a.last_synced_at === null) return true;
    const t = Date.parse(a.last_synced_at);
    return Number.isNaN(t) || nowMs - t >= DUE_AFTER_MS;
  });
}
