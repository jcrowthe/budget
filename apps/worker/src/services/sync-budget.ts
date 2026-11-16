import { RUN_CALL_BUDGET, RUN_CALL_HARD_LIMIT } from "@budget/schema/plaid-import";
import type { Env } from "../env";
import type { PlaidClient } from "../plaid/client";

export class CallLimitReached extends Error {
  constructor() {
    super("call limit reached");
  }
}

export class SyncBudgetTooSmall extends Error {
  constructor() {
    super("sync budget too small");
  }
}

/** Counts the D1 calls and Plaid calls of one run against Cloudflare's per-invocation limits. */
export class CallBudget {
  d1 = 0;
  plaid = 0;
  private allowFailureWrite = false;

  constructor(
    private readonly limit: number = RUN_CALL_BUDGET,
    private readonly hard: number = RUN_CALL_HARD_LIMIT,
  ) {}

  get used(): number {
    return this.d1 + this.plaid;
  }

  /** True when `calls` more calls still leave one for the final batch. */
  fits(calls: number): boolean {
    return this.used + calls + 1 <= this.limit;
  }

  /** Room for batches after `reads` more reads and the final batch. */
  batchesLeft(reads = 0): number {
    return this.limit - this.used - reads - 1;
  }

  /** Allows one call past the hard limit: the write that records a failure. */
  failing(): void {
    this.allowFailureWrite = true;
  }

  charge(kind: "d1" | "plaid"): void {
    if (this.used >= this.hard + (this.allowFailureWrite ? 1 : 0)) throw new CallLimitReached();
    this[kind]++;
  }
}

type Stmt = D1PreparedStatement;

function countedStmt(stmt: Stmt, b: CallBudget): Stmt {
  const s = stmt as unknown as Record<string, unknown>;
  const orig = {
    bind: stmt.bind.bind(stmt),
    all: stmt.all.bind(stmt),
    raw: stmt.raw.bind(stmt),
    first: stmt.first.bind(stmt),
    run: stmt.run.bind(stmt),
  };
  s.bind = (...values: unknown[]) => countedStmt(orig.bind(...values), b);
  for (const m of ["all", "raw", "first", "run"] as const) {
    s[m] = (...args: unknown[]) => {
      b.charge("d1");
      return (orig[m] as (...a: unknown[]) => unknown)(...args);
    };
  }
  return stmt;
}

/** The env with a DB that counts each executed statement and each batch as one call. */
export function countedEnv(env: Env, b: CallBudget): Env {
  const db = env.DB;
  const counted = Object.create(db) as D1Database;
  const c = counted as unknown as Record<string, unknown>;
  c.prepare = (sql: string) => countedStmt(db.prepare(sql), b);
  c.batch = (stmts: Stmt[]) => {
    b.charge("d1");
    return db.batch(stmts);
  };
  c.exec = (sql: string) => {
    b.charge("d1");
    return db.exec(sql);
  };
  return { ...env, DB: counted };
}

/** The Plaid client, each `post` counted as one call. */
export function countedPlaid(p: PlaidClient, b: CallBudget): PlaidClient {
  return {
    environment: p.environment,
    post: (path, body) => {
      b.charge("plaid");
      return p.post(path, body);
    },
  };
}
