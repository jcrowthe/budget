// Pure decisions of the bank import (EXF-462). No imports from core or the Worker: unit-tested alone.

export const SYNC_STATUSES = [
  "connected",
  "delayed",
  "login_required",
  "broken",
  "not_set_up",
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Statuses the schedule skips: only the user (or a repair) can end them. */
export const NEEDS_REPAIR: readonly SyncStatus[] = ["login_required", "broken"];

export const DUE_AFTER_MS = 6 * 3600_000;
export const MATCH_WINDOW_DAYS = 10;
export const RECONCILED_GRACE_DAYS = 3;
export const MAX_UPDATES_PER_RUN = 500;
export const MAX_PAGES_PER_RUN = 4;
/** Calls (D1 statements or batches, plus Plaid calls) one run may plan for, its final batch included.
 *  Free plan: 50 D1 queries and 50 subrequests per invocation; a db.batch is one query. */
export const RUN_CALL_BUDGET = 45;
/** The counter refuses a call past this; the failure write may still make one more. */
export const RUN_CALL_HARD_LIMIT = 48;
/** Entries per unit: D1 allows 100 bound parameters a statement. */
export const SYNC_UNIT_SIZE = 90;
/** One scheduled invocation: at most this many runs (DO requests), and none started after this time. */
export const SCHEDULED_MAX_RUNS = 40;
export const SCHEDULED_WALL_MS = 10 * 60_000;

export interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  /** Plaid's sign: positive is money leaving the account. */
  amount: number;
  date: string;
  name: string | null;
  merchant_name: string | null;
  original_description: string | null;
  pending: boolean;
}

const LOGIN_REQUIRED_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "ACCESS_NOT_GRANTED",
  "USER_PERMISSION_REVOKED",
  "ITEM_LOCKED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "INVALID_UPDATED_USERNAME",
  "INSUFFICIENT_CREDENTIALS",
  "USER_SETUP_REQUIRED",
  "MFA_NOT_SUPPORTED",
  "NO_ACCOUNTS",
]);
const BROKEN_CODES = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

/** The status a failed Plaid call leaves: unknown codes, network (status 0) and 5xx are `delayed`. */
export function syncStatusForError(
  _httpStatus: number,
  code: string | null,
): Exclude<SyncStatus, "connected" | "not_set_up"> {
  if (code && LOGIN_REQUIRED_CODES.has(code)) return "login_required";
  if (code && BROKEN_CODES.has(code)) return "broken";
  return "delayed";
}

interface Page {
  added: PlaidTxn[];
  modified: PlaidTxn[];
  removed: { transaction_id: string }[];
}

/** The net effect of pages read in order: later pages win; pending entries are dropped. */
export function netChanges(pages: Page[]): {
  upserts: { txn: PlaidTxn; kind: "added" | "modified" }[];
  removed: string[];
} {
  const state = new Map<string, { txn: PlaidTxn; kind: "added" | "modified" } | "removed">();
  for (const p of pages) {
    for (const t of p.added) state.set(t.transaction_id, { txn: t, kind: "added" });
    for (const t of p.modified) {
      const prev = state.get(t.transaction_id);
      const kind = prev && prev !== "removed" ? prev.kind : "modified";
      state.set(t.transaction_id, { txn: t, kind });
    }
    for (const r of p.removed) state.set(r.transaction_id, "removed");
  }
  const upserts: { txn: PlaidTxn; kind: "added" | "modified" }[] = [];
  const removed: string[] = [];
  for (const [id, v] of state) {
    if (v === "removed") removed.push(id);
    else if (!v.txn.pending) upserts.push(v);
  }
  return { upserts, removed };
}

export function minusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function daysApart(a: string, b: string): number {
  return Math.round(
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );
}

export function payeeNameOf(t: Pick<PlaidTxn, "merchant_name" | "name">): string | null {
  const n = (t.merchant_name || t.name || "").trim().slice(0, 200).trim();
  return n === "" ? null : n;
}

export function bankDescriptionOf(t: Pick<PlaidTxn, "original_description" | "name">) {
  return t.original_description ?? t.name ?? null;
}

export type SkipReason =
  | "account_closed"
  | "before_start"
  | "before_reconciled"
  | "known"
  | "recovery_duplicate";

/** Why an entry is not imported, in the order of the rules; null when it may be. */
export function skipReason(
  t: { date: string },
  a: {
    closed: boolean;
    importStartDate: string | null;
    startingBalanceDate: string | null;
    latestReconciledDate: string | null;
  },
  known: boolean,
): SkipReason | null {
  if (a.closed) return "account_closed";
  if (
    (a.importStartDate !== null && t.date < a.importStartDate) ||
    (a.startingBalanceDate !== null && t.date < a.startingBalanceDate)
  ) {
    return "before_start";
  }
  if (
    a.latestReconciledDate !== null &&
    t.date < minusDays(a.latestReconciledDate, RECONCILED_GRACE_DAYS)
  ) {
    return "before_reconciled";
  }
  if (known) return "known";
  return null;
}

export interface Candidate {
  id: string;
  date: string;
  amount: number;
  createdAt: string;
}

/** Same amount, within the window, closest date, then the oldest entry, then id; a used one is skipped. */
export function pickMatch(
  imp: { date: string; amount: number },
  cs: Candidate[],
  used: ReadonlySet<string>,
): string | null {
  let best: { c: Candidate; d: number } | null = null;
  for (const c of cs) {
    if (used.has(c.id) || c.amount !== imp.amount) continue;
    const d = daysApart(c.date, imp.date);
    if (d > MATCH_WINDOW_DAYS) continue;
    if (
      !best ||
      d < best.d ||
      (d === best.d &&
        (c.createdAt < best.c.createdAt || (c.createdAt === best.c.createdAt && c.id < best.c.id)))
    ) {
      best = { c, d };
    }
  }
  return best?.c.id ?? null;
}

export function isRecoveryDuplicate(
  imp: { date: string; amount: number },
  existing: { date: string; amount: number }[],
): boolean {
  return existing.some((e) => e.date === imp.date && e.amount === imp.amount);
}

/** The category of a new import: the payee's last one, else Ready to Assign for a deposit into cash. */
export function categoryFor(
  a: { takesCategory: boolean; rtaInflow: boolean },
  amount: number,
  payee: { lastCategoryId: string | null } | null,
): { categoryId: string | null; inflowToReadyToAssign: boolean } {
  if (!a.takesCategory) return { categoryId: null, inflowToReadyToAssign: false };
  if (payee?.lastCategoryId)
    return { categoryId: payee.lastCategoryId, inflowToReadyToAssign: false };
  if (a.rtaInflow && amount > 0) return { categoryId: null, inflowToReadyToAssign: true };
  return { categoryId: null, inflowToReadyToAssign: false };
}

type Held = {
  approved: boolean;
  source?: string | null;
  cleared: "uncleared" | "cleared" | "reconciled";
};

/** What a bank update may change on a row already imported. A reconciled row is never changed but its description. */
export function modifiedPlan(row: Held): "follow" | "description_only" | "bank_description_only" {
  if (row.cleared === "reconciled") return "bank_description_only";
  if (!row.approved && row.source === "plaid") return "follow";
  return "description_only";
}

/** Only an unapproved, unreconciled import the user has not taken over is deleted when the bank withdraws it. */
export function removedPlan(row: Held): "delete" | "keep" {
  return row.cleared !== "reconciled" && !row.approved && row.source === "plaid"
    ? "delete"
    : "keep";
}

export function isDue(lastSyncedAt: string | null, status: string, nowMs: number): boolean {
  if ((NEEDS_REPAIR as readonly string[]).includes(status)) return false;
  if (lastSyncedAt === null) return true;
  const t = Date.parse(lastSyncedAt);
  return Number.isNaN(t) || nowMs - t >= DUE_AFTER_MS;
}

/** The set of linked accounts a cursor was read for: sorted "id:import_start_date" joined by commas. */
export function linkSet(accounts: { id: string; importStartDate: string | null }[]): string {
  return accounts
    .map((a) => `${a.id}:${a.importStartDate ?? ""}`)
    .sort()
    .join(",");
}

/** True when every current link was part of the set the cursor was read for (else the feed is read again from its start). */
export function linksCovered(current: string, stored: string | null): boolean {
  const have = new Set((stored ?? "").split(",").filter(Boolean));
  return current
    .split(",")
    .filter(Boolean)
    .every((x) => have.has(x));
}
