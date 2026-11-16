import { MAX_PAGES_PER_RUN, MAX_UPDATES_PER_RUN, type PlaidTxn } from "@budget/schema/plaid-import";
import { PlaidApiError, type PlaidClient } from "./client";

// The access token goes from `tokens.ts` to these two calls and nowhere else: it is only in a request
// body. Nothing here logs, and a `PlaidApiError` holds only a status and a code.

export const MUTATION_CODE = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";

interface RawTxn {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name?: string | null;
  merchant_name?: string | null;
  original_description?: string | null;
  pending?: boolean;
}

export interface SyncPage {
  added: PlaidTxn[];
  modified: PlaidTxn[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

export interface BalanceAccount {
  account_id: string;
  balances: {
    current?: number | null;
    available?: number | null;
    last_updated_datetime?: string | null;
  };
}

const pick = (t: RawTxn): PlaidTxn => ({
  transaction_id: t.transaction_id,
  account_id: t.account_id,
  amount: t.amount,
  date: t.date,
  name: t.name ?? null,
  merchant_name: t.merchant_name ?? null,
  original_description: t.original_description ?? null,
  pending: t.pending === true,
});

async function readPage(
  plaid: PlaidClient,
  accessToken: string,
  cursor: string | null,
): Promise<SyncPage> {
  const raw = await plaid.post<{
    added?: RawTxn[];
    modified?: RawTxn[];
    removed?: { transaction_id: string }[];
    next_cursor: string;
    has_more: boolean;
  }>("/transactions/sync", {
    access_token: accessToken,
    count: 500,
    options: { include_original_description: true },
    ...(cursor ? { cursor } : {}),
  });
  return {
    added: (raw.added ?? []).map(pick),
    modified: (raw.modified ?? []).map(pick),
    removed: (raw.removed ?? []).map((r) => ({ transaction_id: r.transaction_id })),
    next_cursor: raw.next_cursor,
    has_more: raw.has_more === true,
  };
}

/**
 * Reads pages from `startCursor` (null or '' = the start of the feed) until the bank has no more, or the
 * updates held reach `maxUpdates`, or `maxPages` pages were read. A mutation error restarts from the first
 * cursor of the pagination loop (`loopCursor`, else the start of this run), up to `maxRestarts` times.
 */
export async function fetchSyncPages(
  plaid: PlaidClient,
  accessToken: string,
  startCursor: string | null,
  loopCursor: string | null,
  opts: { maxUpdates?: number; maxPages?: number; maxRestarts?: number } = {},
): Promise<{ pages: SyncPage[]; nextCursor: string | null; hasMore: boolean }> {
  const maxUpdates = opts.maxUpdates ?? MAX_UPDATES_PER_RUN;
  const maxPages = opts.maxPages ?? MAX_PAGES_PER_RUN;
  const maxRestarts = opts.maxRestarts ?? 3;
  const restartFrom = loopCursor ?? startCursor;
  let from = startCursor;
  for (let restarts = 0; ; restarts++) {
    const pages: SyncPage[] = [];
    let held = 0;
    let cursor = from;
    try {
      for (;;) {
        const page = await readPage(plaid, accessToken, cursor);
        pages.push(page);
        held += page.added.length + page.modified.length + page.removed.length;
        cursor = page.next_cursor;
        if (!page.has_more || held >= maxUpdates || pages.length >= maxPages) {
          return { pages, nextCursor: cursor, hasMore: page.has_more };
        }
      }
    } catch (e) {
      if (e instanceof PlaidApiError && e.errorCode === MUTATION_CODE && restarts < maxRestarts) {
        from = restartFrom;
        continue;
      }
      throw e;
    }
  }
}

export async function fetchBalances(
  plaid: PlaidClient,
  accessToken: string,
): Promise<BalanceAccount[]> {
  const got = await plaid.post<{ accounts?: BalanceAccount[] }>("/accounts/get", {
    access_token: accessToken,
  });
  return got.accounts ?? [];
}
