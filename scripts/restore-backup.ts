// Work of scripts/restore-backup.sh (which parses and guards). Run with node --experimental-strip-types.
// Prints table names and counts, never row values.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { BackupManifest, BackupTable } from "../packages/schema/src/backup.ts";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_PREFIX,
} from "../packages/schema/src/backup.ts";

const BUCKET = "budget-files";
const STATEMENT_MAX = 90_000; // D1 allows 100 KB a statement
const ROWS_MAX = 100;

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? "" : (argv[i + 1] ?? "");
};
const remote = opt("target") === "remote";
const root = opt("root");
const persist = opt("persist-to");
const database = opt("database") || "budget-db";

function fail(msg: string): never {
  console.error(`restore-backup: ${msg}`);
  process.exit(1);
}

function wrangler(args: string[]): string {
  const target = remote ? ["--remote"] : ["--local", "--persist-to", persist];
  const full = [
    "--filter",
    "@budget/worker",
    "exec",
    "wrangler",
    ...args,
    ...target,
    "-c",
    `${root}/apps/worker/wrangler.jsonc`,
  ];
  try {
    return execFileSync("pnpm", full, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 28,
    });
  } catch (e) {
    // The wrangler output can hold SQL text; say only which step failed.
    fail(
      `wrangler ${args.slice(0, 3).join(" ")} failed (exit ${(e as { status?: number }).status ?? "?"})`,
    );
  }
}

function d1(extra: string[]): string {
  return wrangler(["d1", "execute", database, ...extra]);
}

function fetchBackup(id: string, out: string) {
  mkdirSync(join(out, "parts"), { recursive: true });
  const get = (key: string, file: string) =>
    wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", file]);
  const mfile = join(out, "manifest.json");
  get(`${BACKUP_PREFIX}${id}.manifest.json`, mfile);
  const m = JSON.parse(readFileSync(mfile, "utf8")) as BackupManifest;
  for (const p of m.parts) get(p.key, join(out, "parts", p.key.split("/").pop() as string));
  console.log(`fetched ${id}: ${m.parts.length} parts, ${m.tables.length} tables`);
}

const hex = (s: string) => Buffer.from(s, "base64").toString("hex");
function literal(v: unknown): string {
  if (v === null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) fail("a non-finite number in a part");
    return String(v);
  }
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  if (typeof v === "object" && v !== null && "b64" in v)
    return `X'${hex((v as { b64: string }).b64)}'`;
  return fail("an unknown value shape in a part");
}
const qi = (n: string) => `"${n.replaceAll('"', '""')}"`;

function readManifest(from: string): BackupManifest {
  const m = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8")) as BackupManifest;
  if (m.format !== BACKUP_FORMAT) fail("not a budget-d1-backup manifest");
  if (m.format_version !== BACKUP_FORMAT_VERSION)
    fail(`unsupported format_version ${m.format_version}`);
  return m;
}

/** The part files' lines per table index, after checking each part's sha256 and row count. */
function readParts(from: string, m: BackupManifest): string[][][] {
  const byTable: string[][][] = m.tables.map(() => []);
  for (const p of m.parts) {
    const buf = readFileSync(join(from, "parts", p.key.split("/").pop() as string));
    if (createHash("sha256").update(buf).digest("hex") !== p.sha256)
      fail(`part ${p.key} fails its sha256`);
    const lines = gunzipSync(buf).toString("utf8").split("\n").filter(Boolean);
    if (lines.length !== p.rows)
      fail(`part ${p.key} has ${lines.length} rows, the manifest says ${p.rows}`);
    for (const line of lines) {
      const row = JSON.parse(line) as unknown[];
      const t = byTable[row[0] as number];
      if (!t) fail("a row names a table the manifest lacks");
      t.push(row.slice(1).map(literal));
    }
  }
  m.tables.forEach((t, i) => {
    if ((byTable[i] as string[][]).length !== t.rows)
      fail(
        `table ${t.name}: parts hold ${(byTable[i] as string[][]).length} rows, the manifest says ${t.rows}`,
      );
  });
  return byTable;
}

function inserts(t: BackupTable, rows: string[][]): string[] {
  const cols = (
    t.rowid_alias
      ? t.columns.map((c) => qi(c.name))
      : [qi("rowid"), ...t.columns.map((c) => qi(c.name))]
  ).join(", ");
  const head = `INSERT INTO ${qi(t.name)} (${cols}) VALUES `;
  const out: string[] = [];
  let cur: string[] = [];
  let size = head.length;
  const flush = () => {
    if (cur.length) out.push(`${head}${cur.join(",")};`);
    cur = [];
    size = head.length;
  };
  for (const r of rows) {
    const tuple = `(${r.join(",")})`;
    if (cur.length && (size + tuple.length + 1 > STATEMENT_MAX || cur.length >= ROWS_MAX)) flush();
    cur.push(tuple);
    size += tuple.length + 1;
  }
  flush();
  return out;
}

function restore(from: string) {
  const m = readManifest(from);
  const byTable = readParts(from, m);
  const probe = d1([
    "--json",
    "--command",
    "select count(*) as n from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'",
  ]);
  const n = (JSON.parse(probe) as { results: { n: number }[] }[])[0]?.results[0]?.n;
  if (n !== 0)
    fail(
      `the target database is not empty (${n ?? "unknown"} tables); restore into a new, empty database`,
    );
  const sql = ["PRAGMA defer_foreign_keys = on;"];
  for (const t of m.tables) sql.push(`${t.sql};`);
  for (const [i, t] of m.tables.entries()) {
    for (const stmt of inserts(t, byTable[i] as string[][])) sql.push(stmt);
  }
  for (const ix of m.indexes) sql.push(`${ix.sql};`);
  const dir = mkdtempSync(join(tmpdir(), "restore-backup-"));
  try {
    const file = join(dir, "restore.sql");
    writeFileSync(file, `${sql.join("\n")}\n`);
    d1(["--file", file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // One statement per table (D1 allows only a few terms in a compound SELECT); one JSON result each.
  const counts = d1([
    "--json",
    "--command",
    m.tables.map((t) => `select count(*) as n from ${qi(t.name)};`).join(" "),
  ]);
  const results = JSON.parse(counts) as { results: { n: number }[] }[];
  const got = new Map(m.tables.map((t, i) => [t.name, results[i]?.results[0]?.n]));
  let bad = 0;
  for (const t of m.tables) {
    const ok = got.get(t.name) === t.rows;
    if (!ok) bad++;
    console.log(`${t.name} ${t.rows} ${ok ? "ok" : `MISMATCH (found ${got.get(t.name)})`}`);
  }
  if (bad) fail(`${bad} table(s) do not match the manifest`);
  console.log(`restored ${m.id}: ${m.tables.length} tables, ${m.rows_total} rows`);
}

if (cmd === "fetch") fetchBackup(opt("id"), opt("out"));
else if (cmd === "restore") restore(opt("from"));
else fail(`unknown command ${cmd}`);
