import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A change set is the id shared by every change_log row one REST or MCP write request writes
 * (docs/undo-design.md, "Change sets"). Only `middleware/change-set.ts` opens one. Outside a request (cron,
 * Durable Objects, services called directly) there is none, and `currentChangeSetId()` is null.
 */
const store = new AsyncLocalStorage<{ id: string }>();

export function runInChangeSet<T>(id: string, fn: () => T): T {
  return store.run({ id }, fn);
}

export function currentChangeSetId(): string | null {
  return store.getStore()?.id ?? null;
}
