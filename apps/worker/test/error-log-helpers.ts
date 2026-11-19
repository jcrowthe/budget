import { env } from "cloudflare:test";
import { afterEach, vi } from "vitest";

/** env.DB whose prepare(q) replaces the table name `table` (word match) with `zz_error_log_missing`, so the
 *  statements that read it fail for real in D1 ("no such table"); everything else passes through, batch included. */
export function brokenDb(table: string): D1Database {
  const real = env.DB;
  const DB = Object.create(real) as D1Database;
  const re = new RegExp(`\\b${table}\\b`, "g");
  (DB as unknown as Record<string, unknown>).prepare = (q: string) =>
    real.prepare(q.replace(re, "zz_error_log_missing"));
  return DB;
}

let spy: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => {
  spy?.mockRestore();
  spy = undefined;
});

/** Spies console.error for the test; returns the lines, each `args.map(String).join(" ")`. Restored in afterEach. */
export function captureErrors(): string[] {
  const lines: string[] = [];
  spy?.mockRestore();
  spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}
