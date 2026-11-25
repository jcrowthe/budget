/**
 * A guard on the test database: every SELECT that runs in a `db.batch` or through `.all()` (drizzle's `db.all(sql…)`)
 * must have distinct output column names. D1 maps those rows into objects keyed by column name, so two columns
 * named alike (`lo_other.name`, `lo_payee.name`) silently become one, and the later one wins (EXF-1006).
 * Drizzle's own `.select({...})` run directly goes through `raw()` and is safe; only batches and `.all()` collide.
 * Label the columns (`sql`…`.as("other_name")`). The check runs `raw({ columnNames: true })` once per distinct SQL.
 */
const checked = new Map<string, string[]>();
const rawOf = new WeakMap<object, D1PreparedStatement["raw"]>();
const sqlOf = new WeakMap<object, string>();
const isRead = (q: string) => /^\s*(select|with)\b/i.test(q);

export function duplicateColumns(names: string[]): string[] {
  return names.filter((n, i) => names.indexOf(n) !== i);
}

async function assertDistinct(st: D1PreparedStatement, q: string) {
  if (!isRead(q) || checked.has(q)) return;
  // The raw() of the statement as D1 made it: a call counter that decorates `st` later must not see this extra read.
  const [names] = (await (rawOf.get(st) ?? st.raw.bind(st))({ columnNames: true })) as [
    string[],
    ...unknown[],
  ];
  const dup = duplicateColumns(names ?? []);
  if (dup.length === 0) checked.set(q, names);
  else {
    throw new Error(
      `Duplicate output column name(s) ${[...new Set(dup)].join(", ")} in a batched/all() select: D1 keeps only the last. Label them with .as(). SQL: ${q}`,
    );
  }
}

/** The database as it was before `guardDb`: tests that show the collision itself run a batch on it. */
export let unguardedDb: D1Database | undefined;

export function guardDb(db: D1Database): D1Database {
  unguardedDb = db;
  // Statements are patched in place (not proxied): other helpers decorate them the same way and must stack.
  const patch = (st: D1PreparedStatement, q: string): D1PreparedStatement => {
    const bind = st.bind.bind(st);
    const all = st.all.bind(st);
    const s = st as unknown as Record<string, unknown>;
    s.bind = (...a: unknown[]) => patch(bind(...a), q);
    s.all = async (...a: unknown[]) => {
      await assertDistinct(st, q);
      return (all as (...x: unknown[]) => unknown)(...a);
    };
    sqlOf.set(st, q);
    rawOf.set(st, st.raw.bind(st));
    return st;
  };
  const own: Record<string | symbol, unknown> = {
    prepare: (q: string) => patch(db.prepare(q), q),
    batch: async (list: D1PreparedStatement[]) => {
      for (const s of list) await assertDistinct(s, sqlOf.get(s) ?? "");
      return db.batch(list);
    },
  };
  return new Proxy(db, {
    get(t, k) {
      if (k in own) return own[k];
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
}
