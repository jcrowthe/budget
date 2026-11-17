import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// EXF-468: every amount and date on a screen or in a file goes through the plan's formatter
// (packages/schema/src/plan-formats.ts). A file that formats money or a date by itself fails here.
const root = new URL("../..", import.meta.url).pathname;
const PATTERNS: RegExp[] = [
  /style:\s*["']currency["']/,
  /\bformatMoney\(/,
  /\$\$\{/,
  /(["'])\$\1/,
  /["'`][^"'`\n]*\$\d/,
  /replace(All)?\(\s*["']\$["']/,
  /minimumFractionDigits/,
  /["']MM\/DD\/YYYY["']/,
  /slice\(5,\s*7\)\}\//,
  /\}\/\$\{[^}]+\}\/\$\{/,
];

const ALLOWED: Record<string, string> = {
  "packages/schema/src/plan-formats.ts":
    "the formatter itself: DEFAULT_PLAN_FORMATS holds the default date format",
  "packages/schema/src/plan-formats-catalogue.ts": "the catalogue: the default stored formats",
  "packages/schema/src/plan-export.ts":
    "exportFormat and DEFAULT_PLAN_FORMAT: the files' formatter",
  "packages/schema/src/plan-import-read.ts": "DATE_FORMATS lists the format strings",
  "packages/schema/src/budgets.ts": "the zod default of a plan's date_format (the stored default)",
  "packages/schema/src/plan-import.ts": "the importer's starting guess when a file has no dates",
  "packages/schema/src/report-range.ts": "MM/YY axis labels are not part of the date format",
  "apps/worker/src/db/schema/budgets.ts": "the column's default",
  "apps/web/src/plan/columnWidths.ts":
    "the sample text the number columns are capped at, in no one's format",
  "apps/web/src/reflect/format.ts": "percent text, not money (out of scope)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function hitsOf(file: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return; // a comment names an example; it formats nothing
    if (PATTERNS.some((re) => re.test(line))) out.push(`${relative(root, file)}:${i + 1}`);
  });
  return out;
}

describe("plan formats: no screen formats money or a date by itself", () => {
  const files = ["apps/web/src", "packages/schema/src", "apps/worker/src"].flatMap((d) =>
    walk(join(root, d)),
  );
  it("finds nothing outside the allowed files", () => {
    const hits = files
      .flatMap(hitsOf)
      .filter((h) => !Object.keys(ALLOWED).some((a) => h.startsWith(`${a}:`)));
    expect(hits, `format through usePlanFormatter or a PlanFormatter:\n${hits.join("\n")}`).toEqual(
      [],
    );
  });
  it("still finds something in each allowed file", () => {
    for (const a of Object.keys(ALLOWED))
      expect(hitsOf(join(root, a)).length, a).toBeGreaterThan(0);
  });
});
