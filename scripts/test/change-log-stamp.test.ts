import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Undo/Redo U1: every change_log insert stamps change_set_id (docs/undo-design.md, "Change sets"), or a row
// written inside a request is not part of its change set and an undo would miss it.
const root = new URL("../..", import.meta.url).pathname;
const STAMP = /changeSetId:\s*currentChangeSetId\(\)/;

// file#function -> why it is exempt. Each entry must still match a site.
const ALLOW: Record<string, string> = {
  "apps/worker/src/repositories/payees.ts#livePayeesCheck":
    "fails on purpose (NOT NULL actor) to abort the batch when a payee is gone; it never commits a row, so there is nothing to stamp",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** The text from `open` (index of a "(") to its matching ")". */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

type Site = { id: string; stamped: boolean };

function sitesOf(file: string): Site[] {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file);
  const out: Site[] = [];
  const at = (index: number, body: string) => {
    const before = text.slice(0, index);
    const fn = [...before.matchAll(/function\s+(\w+)/g)].pop()?.[1] ?? "?";
    out.push({
      id: `${rel}#${fn}:${before.split("\n").length}`,
      stamped: STAMP.test(body),
    });
  };
  const imp = text.match(/import\s*\{([^}]*)\}\s*from\s*"[^"]*db\/schema\/change-log"/);
  if (imp) {
    const spec = (imp[1] ?? "").split(",").map((s) => s.trim());
    const local = spec.map((s) => s.match(/^changeLog(?:\s+as\s+(\w+))?$/)).find(Boolean)?.[1];
    const name = local ?? (spec.includes("changeLog") ? "changeLog" : null);
    if (name) {
      for (const m of text.matchAll(new RegExp(`\\.insert\\(\\s*${name}\\s*\\)`, "g"))) {
        const end = m.index + m[0].length;
        const values = /^\s*\.values\(/.exec(text.slice(end));
        const body = values ? balanced(text, end + values[0].length - 1) : "";
        at(m.index, m[0] + body);
      }
      for (const m of text.matchAll(new RegExp(`insertSelect\\(\\s*[^,]+,\\s*${name}\\s*,`, "g"))) {
        at(m.index, balanced(text, m.index + "insertSelect".length));
      }
    }
  }
  for (const m of text.matchAll(/insert\s+into\s+"?change_log"?[^;`]*/gi)) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(\*|\/\/|\/\*)/.test(text.slice(lineStart, m.index))) continue; // a comment, not SQL
    at(m.index, m[0].includes("change_set_id") ? "changeSetId: currentChangeSetId()" : m[0]);
  }
  return out;
}

describe("change_log inserts", () => {
  const sites = walk(join(root, "apps/worker/src")).flatMap(sitesOf);
  const key = (s: Site) => s.id.replace(/:\d+$/, "");

  it("stamp change_set_id", () => {
    const bad = sites.filter((s) => !s.stamped && !(key(s) in ALLOW));
    expect(
      bad.map((s) => s.id),
      `stamp change_set_id (changeSetId: currentChangeSetId()) at: ${bad.map((s) => s.id).join(", ")}`,
    ).toEqual([]);
  });

  it("finds the known sites, and every allow-list entry still matches one", () => {
    const keys = new Set(sites.map(key));
    for (const k of [
      "apps/worker/src/history/change-log.ts#changeLogInsert",
      "apps/worker/src/history/change-log.ts#changeLogInsertIf",
      "apps/worker/src/repositories/guards.ts#logSelectStmt",
      "apps/worker/src/repositories/reconcile.ts#reconcileLogsStmt",
      "apps/worker/src/services/credit-payments.ts#paymentCreateStmts",
    ]) {
      expect(keys.has(k), `scanner lost ${k}`).toBe(true);
    }
    for (const k of Object.keys(ALLOW))
      expect(keys.has(k), `stale allow-list entry ${k}`).toBe(true);
  });
});
