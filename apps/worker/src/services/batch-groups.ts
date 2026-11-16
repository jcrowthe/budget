import type { Db } from "../db/client";

type Stmts = Parameters<Db["batch"]>[0];

/** A set of statements that belong together: a group never straddles two batches. */
export type StatementGroup = unknown[];

/** The statements per batch: D1 limits a statement to 100 bound parameters, and a batch is kept small. */
export const STATEMENTS_PER_BATCH = 90;

/**
 * Runs the groups in order, in batches of at most `max` statements (a group alone may be larger).
 * Returns, per group, the number of rows each of its statements changed.
 */
export async function runGroups(
  db: Db,
  groups: readonly StatementGroup[],
  max = STATEMENTS_PER_BATCH,
): Promise<number[][]> {
  const out: number[][] = [];
  let batch: unknown[] = [];
  let members: number[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const results = (await db.batch(batch as unknown as Stmts)) as unknown as {
      meta: { changes?: number };
    }[];
    let at = 0;
    for (const g of members) {
      const n = (groups[g] as unknown[]).length;
      out[g] = results.slice(at, at + n).map((r) => r.meta.changes ?? 0);
      at += n;
    }
    batch = [];
    members = [];
  };
  for (const [i, g] of groups.entries()) {
    if (g.length === 0) {
      out[i] = [];
      continue;
    }
    if (batch.length > 0 && batch.length + g.length > max) await flush();
    batch.push(...g);
    members.push(i);
  }
  await flush();
  return out;
}
