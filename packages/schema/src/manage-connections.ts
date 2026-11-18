// Pure rules of the Manage Bank Connections screens (EXF-460): the groups, the labels, the Reset wait.
import { connectionLabel, type LinkStatus } from "./bank-link";
import { shownLabel } from "./connection-status";
import type { StatusReason } from "./plaid-import";

export type ConnectionGroup = "attention" | "delayed" | "others";

export const CONNECTION_GROUPS: { id: ConnectionGroup; heading: string }[] = [
  { id: "attention", heading: "Needs Attention" },
  { id: "delayed", heading: "Delayed" },
  { id: "others", heading: "All Others" },
];

/** connected → All Others, delayed → Delayed, anything else (login_required, broken, unknown) → Needs Attention. */
export function connectionGroup(status: string): ConnectionGroup {
  if (status === "connected") return "others";
  if (status === "delayed") return "delayed";
  return "attention";
}

const KNOWN: LinkStatus[] = ["connected", "delayed", "login_required", "broken"];

/** The connection's name: its reason's words when it has one, else its status's. */
export function statusLabel(status: string, reason: StatusReason | null = null): string {
  if (!KNOWN.includes(status as LinkStatus)) return "Connection Repair Needed";
  return reason ? shownLabel(reason) : connectionLabel(status as LinkStatus);
}

export function connectionBadge(
  status: string,
  reason: StatusReason | null = null,
): "Repair" | "Reauthorize" | "Delayed" | "Unavailable" | null {
  const g = connectionGroup(status);
  if (g === "attention") return reason === "reauthorize" ? "Reauthorize" : "Repair";
  if (g === "delayed")
    return reason === "unavailable" || reason === "unsupported" ? "Unavailable" : "Delayed";
  return null;
}

export function accountCountLabel(n: number): string {
  return `${n} ${n === 1 ? "Account" : "Accounts"}`;
}

export const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** When Reset is available again, or null when it is available now (the Worker's rule). */
export function resetAvailableAt(lastResetAt: string | null, now = Date.now()): string | null {
  if (!lastResetAt) return null;
  const at = Date.parse(lastResetAt) + RESET_INTERVAL_MS;
  return now >= at ? null : new Date(at).toISOString();
}
