import type { InvalidateQueryFilters, QueryClient } from "@tanstack/react-query";

/**
 * Refetches what a write changed, starting after the write. A plain `invalidateQueries` joins a first load that is
 * still in flight (`cancelRefetch` only applies to a query that already has data), and that read was answered before
 * the write: its stale result would land and nothing would refetch it. Cancelling first makes the refetch a new read.
 */
export async function refetchAfterWrite(qc: QueryClient, filters: InvalidateQueryFilters) {
  await qc.cancelQueries(filters);
  await qc.invalidateQueries(filters);
}
