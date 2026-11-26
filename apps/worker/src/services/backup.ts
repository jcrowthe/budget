import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_KEEP,
  BACKUP_PREFIX,
  BACKUP_PRUNE_PER_RUN,
  BACKUP_ROWS_PER_RUN,
  BACKUP_STATE_KEY,
  type BackupIndex,
  type BackupManifest,
  type BackupState,
  type BackupTable,
} from "@budget/schema/backup";
import type { BackupErrorCode } from "@budget/schema/backup-status";
import type { Env } from "../env";
import { describeError, LOG_LINE_MAX } from "../middleware/errors";
import { gzip, isRowidAlias, pageSql, rowLine, sha256Hex } from "./backup-format";
import { recordBackupFailure, recordBackupSuccess } from "./backup-status";

// The nightly D1 backup (EXF-976, docs/backup-design.md). Raw env.DB statements: the identifiers come from
// sqlite_master, never from input; no IN lists.

export type BackupOutcome = "noop" | "continuing" | "done" | "abandoned" | "failed";
type Progress = NonNullable<BackupState["in_progress"]>;
type StateFile = BackupState & {
  last_done?: string | null;
  /** The last finished backup's time: a failed run keeps it in the status without an R2 get. */
  last_success_at?: string | null;
  prune_pending?: boolean;
};

const manifestKey = (id: string) => `${BACKUP_PREFIX}${id}.manifest.json`;
const MIN_ROWID = -9007199254740991;

async function readState(env: Env): Promise<StateFile> {
  const o = await env.FILES.get(BACKUP_STATE_KEY);
  if (!o) return { in_progress: null };
  try {
    const s = (await o.json()) as StateFile;
    return s && typeof s === "object"
      ? { ...s, in_progress: s.in_progress ?? null }
      : { in_progress: null };
  } catch {
    return { in_progress: null };
  }
}

const writeState = (env: Env, s: StateFile) => env.FILES.put(BACKUP_STATE_KEY, JSON.stringify(s));

interface SchemaRow {
  type: "table" | "index";
  name: string;
  tbl_name: string;
  sql: string;
  col: string | null;
  ctype: string | null;
  pk: number | null;
  ver: string | null;
}

/** D1 call 1 of a start: the application tables with their columns, the indexes, the newest migration. */
async function readSchema(env: Env) {
  const { results } = await env.DB.prepare(
    `select m.type, m.name, m.tbl_name, m.sql, p.name as col, p.type as ctype, p.pk,
            (select max(name) from d1_migrations) as ver
       from sqlite_master m left join pragma_table_info(m.name) p on m.type = 'table'
      where m.type in ('table', 'index') and m.sql is not null
        and m.name not like 'sqlite_%' and m.name not like '_cf_%'
        and m.tbl_name not like 'sqlite_%' and m.tbl_name not like '_cf_%'
      order by m.type, m.name, p.cid`,
  ).all<SchemaRow>();
  const tables: BackupTable[] = [];
  const indexes: BackupIndex[] = [];
  for (const r of results) {
    if (r.type === "index") {
      indexes.push({ name: r.name, table: r.tbl_name, sql: r.sql });
      continue;
    }
    let t = tables[tables.length - 1];
    if (t?.name !== r.name) {
      t = { name: r.name, sql: r.sql, columns: [], rowid_alias: null, rows: 0 };
      tables.push(t);
    }
    if (r.col !== null) t.columns.push({ name: r.col, type: r.ctype ?? "", pk: r.pk ?? 0 });
  }
  for (const t of tables) t.rowid_alias = isRowidAlias(t.columns);
  return { tables, indexes, version: results[0]?.ver ?? "" };
}

/**
 * Reads the next page of every unfinished table in one batch (one D1 call; a batch is one transaction).
 * `check` adds the migration read first. Returns the part's text, and updates `p`.
 */
async function readPages(env: Env, p: Progress, rowsPerRun: number, check: boolean) {
  const todo = p.tables.filter((t) => !p.done.includes(t.name));
  const limit = Math.max(1, Math.floor(rowsPerRun / Math.max(1, todo.length)));
  const stmts: D1PreparedStatement[] = [];
  if (check) stmts.push(env.DB.prepare("select max(name) as ver from d1_migrations"));
  for (const t of todo) {
    stmts.push(env.DB.prepare(pageSql(t)).bind(p.cursors[t.name] ?? MIN_ROWID, limit + 1));
  }
  if (stmts.length === 0) return { text: "", rows: 0, changed: false };
  const res = await env.DB.batch<Record<string, unknown>>(stmts);
  let at = 0;
  if (check) {
    const ver = (res[at++]?.results[0] as { ver?: string } | undefined)?.ver ?? "";
    if (ver !== p.schema_version) return { text: "", rows: 0, changed: true };
  }
  const lines: string[] = [];
  for (const t of todo) {
    const rows = res[at++]?.results ?? [];
    const take = rows.slice(0, limit);
    const index = p.tables.indexOf(t);
    for (const row of take) lines.push(rowLine(index, t, row));
    const last = take[take.length - 1];
    if (last) p.cursors[t.name] = last.__rowid as number;
    p.counts[t.name] = (p.counts[t.name] ?? 0) + take.length;
    if (rows.length <= limit) p.done.push(t.name);
  }
  return { text: lines.length ? `${lines.join("\n")}\n` : "", rows: lines.length, changed: false };
}

async function writePart(env: Env, p: Progress, text: string, rows: number) {
  const body = await gzip(text);
  const key = `${BACKUP_PREFIX}${p.id}/parts/${String(p.parts.length + 1).padStart(5, "0")}.ndjson.gz`;
  await env.FILES.put(key, body);
  p.parts.push({ key, rows, bytes: body.byteLength, sha256: await sha256Hex(body) });
}

/** Deletes the objects under one set's folder, and its manifest, in one delete. */
async function deleteSet(env: Env, id: string, withManifest: boolean) {
  const keys = (
    await env.FILES.list({ prefix: `${BACKUP_PREFIX}${id}/`, limit: 1000 })
  ).objects.map((o) => o.key);
  if (withManifest) keys.push(manifestKey(id));
  if (keys.length) await env.FILES.delete(keys);
}

/** Keeps the newest BACKUP_KEEP manifests; deletes older sets and orphan folders, BACKUP_PRUNE_PER_RUN a time. */
async function prune(env: Env, inProgress: string | null): Promise<boolean> {
  const l = await env.FILES.list({ prefix: BACKUP_PREFIX, delimiter: "/" });
  const manifests = l.objects
    .map((o) => o.key.slice(BACKUP_PREFIX.length))
    .filter((k) => k.endsWith(".manifest.json"))
    .map((k) => k.slice(0, -".manifest.json".length))
    .sort();
  const kept = new Set(manifests.slice(-BACKUP_KEEP));
  const folders = l.delimitedPrefixes.map((k) => k.slice(BACKUP_PREFIX.length, -1));
  const doomed = [...new Set([...manifests, ...folders])]
    .filter((id) => !kept.has(id) && id !== inProgress)
    .sort();
  for (const id of doomed.slice(0, BACKUP_PRUNE_PER_RUN))
    await deleteSet(env, id, manifests.includes(id));
  return doomed.length > BACKUP_PRUNE_PER_RUN;
}

async function finish(env: Env, p: Progress, state: StateFile, now: Date): Promise<number> {
  const tables = p.tables.map((t) => ({ ...t, rows: p.counts[t.name] ?? 0 }));
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    id: p.id,
    started_at: p.started_at,
    finished_at: now.toISOString(),
    schema_version: p.schema_version,
    deploy_sha: env.DEPLOY_SHA,
    tables,
    indexes: p.indexes,
    parts: p.parts,
    rows_total: tables.reduce((n, t) => n + t.rows, 0),
  };
  // The manifest goes before the state: the state is the source of truth, and the parts' keys are fixed, so
  // a failure before the state write only makes the next invocation redo this last read.
  await env.FILES.put(manifestKey(p.id), JSON.stringify(manifest));
  let failure: unknown;
  try {
    state.prune_pending = await prune(env, null);
  } catch (e) {
    state.prune_pending = true;
    failure = e;
  }
  state.in_progress = null;
  state.last_done = p.id;
  state.last_success_at = now.toISOString();
  await writeState(env, state);
  if (failure) throw failure;
  return tables.length;
}

async function step(
  env: Env,
  now: Date,
  rowsPerRun: number,
  at: { code: BackupErrorCode; lastSuccess: string | null },
): Promise<BackupOutcome> {
  const state = await readState(env);
  // Older state files carry only the date of the last backup.
  at.lastSuccess =
    state.last_success_at ?? (state.last_done ? `${state.last_done}T00:00:00.000Z` : null);
  const today = now.toISOString().slice(0, 10);
  let p = state.in_progress;
  let check = true;
  if (!p) {
    if (state.last_done === today) {
      if (state.prune_pending) {
        state.prune_pending = await prune(env, null);
        await writeState(env, state);
      }
      return "noop";
    }
    const s = await readSchema(env);
    p = {
      id: today,
      started_at: now.toISOString(),
      schema_version: s.version,
      tables: s.tables,
      indexes: s.indexes,
      cursors: {},
      counts: {},
      done: [],
      parts: [],
    };
    check = false;
  }
  at.code = "read_failed";
  const r = await readPages(env, p, rowsPerRun, check);
  if (r.changed) {
    // A migration landed mid-backup: its pages no longer match the schema they were read for.
    await deleteSet(env, p.id, false);
    state.in_progress = null;
    await writeState(env, state);
    console.error(`backup abandoned ${p.id} | schema changed`);
    return "abandoned";
  }
  at.code = "write_failed";
  if (r.rows > 0) await writePart(env, p, r.text, r.rows);
  if (p.done.length === p.tables.length) {
    at.code = "finish_failed";
    const tables = await finish(env, p, state, now);
    const rows = Object.values(p.counts).reduce((n, c) => n + c, 0);
    console.log(`backup done ${p.id} tables=${tables} rows=${rows} parts=${p.parts.length}`);
    await recordStatus(() => recordBackupSuccess(env, now));
    return "done";
  }
  state.in_progress = p;
  await writeState(env, state);
  console.log(`backup continuing ${p.id} rows=${r.rows}`);
  return "continuing";
}

/** The status write never changes the run's outcome; a failure of it is one quiet line (stale shows it after 36 h). */
async function recordStatus(write: () => Promise<void>) {
  try {
    await write();
  } catch {
    console.log("backup status not written");
  }
}

/** One backup invocation. Never throws: a failure logs one line (no id beyond the date, no value). */
export async function backupRun(
  env: Env,
  now: Date = new Date(),
  opts: { rowsPerRun?: number } = {},
): Promise<BackupOutcome> {
  // Until the first read, a failure is a read failure: the schema read and the state get both read.
  const at: { code: BackupErrorCode; lastSuccess: string | null } = {
    code: "read_failed",
    lastSuccess: null,
  };
  try {
    return await step(env, now, opts.rowsPerRun ?? BACKUP_ROWS_PER_RUN, at);
  } catch (e) {
    console.error(`backup failed | ${describeError(e)}`.slice(0, LOG_LINE_MAX));
    await recordStatus(() => recordBackupFailure(env, now, at.code, at.lastSuccess));
    return "failed";
  }
}
