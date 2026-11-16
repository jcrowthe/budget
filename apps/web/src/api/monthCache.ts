import type { QueryClient } from "@tanstack/react-query";

// One rule for every writer of the cached months of a plan (Assigned, collapse, category writes, the note):
// 1. before an optimistic write, in-flight month fetches of the plan are cancelled (they would return the old
//    value and overwrite it);
// 2. writes are counted per plan across all writers, and the plan's months are refetched only when the count
//    returns to zero, never while another write is pending (the refetch replaces any fetch still in flight);
// 3. a failed write puts back only its own value (the writer does that).
const pending = new Map<string, number>();

/** Call before the optimistic write; pair every call with `endWrite`. */
export async function beginWrite(qc: QueryClient, budgetId: string): Promise<void> {
  pending.set(budgetId, (pending.get(budgetId) ?? 0) + 1);
  await qc.cancelQueries({ queryKey: ["month", budgetId] });
}

/** Call when the write has settled (success or failure). Refetches the plan's months when none is pending. */
export function endWrite(qc: QueryClient, budgetId: string): void {
  const n = (pending.get(budgetId) ?? 1) - 1;
  if (n > 0) {
    pending.set(budgetId, n);
    return;
  }
  pending.delete(budgetId);
  void qc.invalidateQueries({ queryKey: ["month", budgetId] });
  void qc.invalidateQueries({ queryKey: ["month-list", budgetId] });
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Runs the writes of one plan one after another, in call order (an absolute Assigned PATCH must not be
 * overtaken by a later move of the same cell). Resolves or rejects with `fn`'s own outcome; a failure does
 * not stop the queue.
 */
export function inOrder<T>(budgetId: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(budgetId) ?? Promise.resolve()).then(fn);
  queues.set(
    budgetId,
    run.catch(() => undefined),
  );
  return run;
}
