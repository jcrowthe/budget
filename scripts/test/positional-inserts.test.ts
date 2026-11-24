import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// EXF-725: no statement depends on a table's column order. Drizzle's `insert(t).select(...)` lists every column of
// `t`, so a table that gains a column breaks it; use `insertSelect` (repositories/insert-select.ts) instead.
const root = new URL("../..", import.meta.url).pathname;
const POSITIONAL = /\.insert\([^)]*\)\s*\.select\(/g;

// The helper is the one place that calls `.insert(t).select(` on purpose: `t` is a sub-table naming only the columns
// written. Nothing else is exempt.
const HELPER = "apps/worker/src/repositories/insert-select.ts";

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
  it("are nowhere in the worker", () => {
    const files = walk(join(root, "apps/worker/src")).filter((f) => relative(root, f) !== HELPER);
    const hits = files.flatMap(hitsOf);
    expect(hits, `name the columns with insertSelect: ${hits.join(", ")}`).toEqual([]);
  });
});
