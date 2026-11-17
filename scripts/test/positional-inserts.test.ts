import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// EXF-725: no statement depends on a table's column order. Drizzle's `insert(t).select(...)` lists every column of
// `t`, so a table that gains a column breaks it; use `insertSelect` (repositories/insert-select.ts) instead.
const root = new URL("../..", import.meta.url).pathname;
const POSITIONAL = /\.insert\([^)]*\)\s*\.select\(/g;

const ALLOWED = [
  "apps/worker/src/repositories/insert-select.ts", // the helper itself: it names the columns of the sub-table
  "apps/worker/src/history/change-log.ts", // a shared module of the profile: not this Build's to change
  "apps/worker/src/repositories/reconcile.ts", // out of bounds for this Build
  "apps/worker/src/repositories/month-categories.ts", // another Build is working there
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function hitsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(POSITIONAL)].map(
    (m) => `${relative(root, file)}:${text.slice(0, m.index).split("\n").length}`,
  );
}

describe("positional inserts", () => {
  const files = walk(join(root, "apps/worker/src"));
  it("are only in the allowed files", () => {
    const hits = files.flatMap(hitsOf).filter((h) => !ALLOWED.some((a) => h.startsWith(`${a}:`)));
    expect(hits, `name the columns with insertSelect: ${hits.join(", ")}`).toEqual([]);
  });
  it("are still in each allowed file (remove a file from the list once it is converted)", () => {
    for (const a of ALLOWED) expect(hitsOf(join(root, a)).length, a).toBeGreaterThan(0);
  });
});
