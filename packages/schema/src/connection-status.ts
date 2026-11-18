import { connectionLabel, type LinkStatus, linkStatus } from "./bank-link";
import { reconciledAgo } from "./reconcile";

/** A delayed connection gets its own line after this long without a successful sync. */
export const DELAY_LINE_AFTER_MS = 72 * 3600_000;

export const REPAIR_STRIP = "Repair your bank connection to continue importing transactions.";
export const BROKEN_TEXT =
  "This bank connection cannot be repaired. Remove it and connect the bank again.";
export const DELAY_LINE =
  "Imports have been delayed for over 3 days. Try Reset in Bank Connections.";
export const REPAIR_TEXT =
  "Your bank needs you to sign in again before new transactions can be imported.";
export const DELAYED_TEXT =
  "Your bank or the import service did not answer the last time Budget asked. Budget tries again on its own, so new transactions may arrive late.";
export const CLOSED_NOTICE = "The bank sign-in was closed. Nothing was changed.";

export type Strip = { kind: "repair" | "broken" | "delayed"; text: string } | null;

/**
 * True when the last successful sync (or, for a connection never synced, its creation) is more than 72 hours
 * old. `createdAt` is undefined while the connections read has not answered: then there is no line.
 */
export function delayedOverThreeDays(
  lastSyncedAt: string | null,
  createdAt: string | undefined,
  nowMs: number,
): boolean {
  const from = lastSyncedAt ?? createdAt;
  if (from === undefined) return false;
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t > DELAY_LINE_AFTER_MS;
}

/** The strip of a linked account's page, or null. */
export function stripFor(
  a: {
    linked: boolean;
    closed: boolean;
    connection_status: LinkStatus | null;
    last_synced_at: string | null;
  },
  connectionCreatedAt: string | undefined,
  nowMs: number,
): Strip {
  if (a.closed) return null;
  const s = linkStatus(a);
  if (s === null || s === "connected") return null;
  if (s === "login_required") return { kind: "repair", text: REPAIR_STRIP };
  if (s === "broken") return { kind: "broken", text: BROKEN_TEXT };
  return delayedOverThreeDays(a.last_synced_at, connectionCreatedAt, nowMs)
    ? { kind: "delayed", text: DELAY_LINE }
    : null;
}

/** "Last checked an hour ago", or "Not checked yet". */
export function lastCheckedText(lastSyncedAt: string | null, nowMs: number): string {
  if (lastSyncedAt === null || Number.isNaN(new Date(lastSyncedAt).getTime())) {
    return "Not checked yet";
  }
  return `Last checked ${reconciledAgo(lastSyncedAt, nowMs)}`;
}

export type Popup = { title: string; line: string; action: "repair" | null };

/** The sidebar mark's popup: the status's name, one sentence and the action. */
export function popupFor(s: LinkStatus, lastSyncedAt: string | null, nowMs: number): Popup {
  const title = connectionLabel(s);
  switch (s) {
    case "connected":
      return { title, line: lastCheckedText(lastSyncedAt, nowMs), action: null };
    case "login_required":
      return { title, line: REPAIR_TEXT, action: "repair" };
    case "delayed":
      return { title, line: DELAYED_TEXT, action: null };
    case "broken":
      return { title, line: BROKEN_TEXT, action: null };
  }
}

export type Rect = { left: number; top: number; right: number; bottom: number };

const GAP = 8;

/**
 * Fixed position of the popup: 8 px right of the mark, centred on it, kept 8 px inside the window; left of
 * the mark when there is no room on the right.
 */
export function placeStatusPopup(
  mark: Rect,
  size: { width: number; height: number },
  vw: number,
  vh: number,
): { left: number; top: number } {
  let left = mark.right + GAP;
  if (left + size.width > vw - GAP) left = mark.left - GAP - size.width;
  left = Math.max(GAP, Math.min(left, vw - GAP - size.width));
  const centre = (mark.top + mark.bottom) / 2;
  let top = centre - size.height / 2;
  top = Math.max(GAP, Math.min(top, vh - GAP - size.height));
  return { left, top };
}
