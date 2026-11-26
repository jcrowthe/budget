import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";

/**
 * The key of a scheduled row in the register. A series keeps its id; the derived mirror of a transfer scheduled
 * in another account shares that id, so it is keyed apart (All Accounts lists both).
 */
export const scheduledRowKey = (s: Pick<ScheduledTransaction, "id" | "mirror">): string =>
  s.mirror ? `mirror:${s.id}` : s.id;

/** The unique series ids of the selected row keys, in row order: every action takes the series id, so both rows of one series act once. */
export function seriesIds(
  keys: ReadonlySet<string>,
  rows: readonly Pick<ScheduledTransaction, "id" | "mirror">[],
): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    if (keys.has(scheduledRowKey(r)) && !ids.includes(r.id)) ids.push(r.id);
  }
  return ids;
}
