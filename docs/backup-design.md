# Nightly D1 backup design (EXF-976)

A nightly copy of the whole D1 database (`budget-db`, binding `DB`) to the `budget-files` R2 bucket (binding
`FILES`), with retention, and a restore script tested against local D1 only. **Worker only, plus a script and this
document.** No migration, no new secret or binding, no route, no MCP tool, no screen.
Spec: the Build's `spec.md` (Thread folder).

Before this, the only safety net was the D1 Time Travel bookmark that `scripts/deploy.sh` takes before each release.

## Facts it rests on (base `7072fd3`)

- `apps/worker/src/scheduled.ts`: one cron (`0 3,9,15,21 * * *`) runs `cronRun`: enterDue (≤ `SCHEDULER_CRON_CALLS`
  = 3 D1), then `syncDueConnections` with `SCHEDULED_MAX_RUNS − SCHEDULER_CRON_CALLS` = 37 Durable Object runs, plus
  its two reads. That is about 42 of the 50 calls one invocation has on the Free plan, reading D1 queries and
  subrequests (R2 included) as one allowance ([sync budget design](sync-budget-design.md), "Facts").
- The schema has 24 application tables plus `d1_migrations`; indexes; no triggers, views or `WITHOUT ROWID` tables.
  `secrets.ciphertext` and `secrets.iv` are BLOBs. `d1_migrations.id` is a rowid alias.
- A Worker cannot call the D1 export API without an account API token, so the backup reads the tables itself.

## Decisions

### 1. Schedule: its own cron, `*/5 4 * * *`

- `wrangler.jsonc` gets a second cron, `*/5 4 * * *` (04:00 to 04:55 UTC, 12 invocations). `scheduled()` runs the
  backup when `controller.cron` is `BACKUP_CRON` (`packages/schema/src/backup.ts`). Any other cron, or none, runs
  `cronRun` exactly as before.
- **Why its own invocation:** a cron invocation has its own allowance of calls. The backup never takes a D1 call or
  a run from enterDue or the bank sync, and the 6-hourly invocation does the same work as before (a test checks:
  0 R2 calls, same D1 count).
- **Why 04 UTC:** an hour after the 03:00 run, whose sync starts no run after 10 minutes (`SCHEDULED_WALL_MS`), and
  five hours before the 09:00 run.
- Two crons is within the Free plan's limit of cron triggers.

### 2. Resumable

- A backup's id is the UTC date of its first invocation (`2026-11-25`).
- Progress is kept in R2 (`backups/d1/state.json`), not in D1, because this needs no migration.
- One invocation reads at most `BACKUP_ROWS_PER_RUN` rows. An unfinished backup continues at the next invocation:
  5 minutes later, or in the next night's window.
- A new backup starts only when none is in progress and today's id has no manifest. Most nights the 04:00
  invocation finishes it, and the other eleven cost one R2 `get` each.

### 3. Format (`budget-d1-backup`, version 1)

```
backups/d1/state.json                         progress of the backup in progress, or none
backups/d1/2026-11-25.manifest.json           written last: present = the backup is complete
backups/d1/2026-11-25/parts/00001.ndjson.gz   one part per invocation that read rows
```

- **Part:** gzip (`CompressionStream("gzip")`) of NDJSON. Each line is `[tableIndex, rowid, v1, v2, …]`, with
  values in the manifest's column order. For a table whose rowid is an alias column, the alias is not repeated.
  `null`, numbers and strings are plain JSON; a BLOB is `{"b64":"…"}`.
- **Manifest:** schema and counts, **never row data**. Example (made-up values):

```json
{
  "format": "budget-d1-backup", "format_version": 1, "id": "2026-11-25",
  "started_at": "2026-11-25T04:00:01.120Z", "finished_at": "2026-11-25T04:00:02.480Z",
  "schema_version": "20261124220000_file_imports.sql", "deploy_sha": "<sha>",
  "tables": [
    { "name": "accounts", "sql": "CREATE TABLE accounts (…)",
      "columns": [{ "name": "id", "type": "TEXT", "pk": 1 }], "rowid_alias": null, "rows": 12 }
  ],
  "indexes": [{ "name": "accounts_budget", "table": "accounts", "sql": "CREATE INDEX accounts_budget ON accounts (…)" }],
  "parts": [{ "key": "backups/d1/2026-11-25/parts/00001.ndjson.gz", "rows": 4810, "bytes": 912345, "sha256": "…" }],
  "rows_total": 4810
}
```

- The manifest sits beside the parts folder, not inside it. So one `list({ prefix: "backups/d1/", delimiter: "/" })`
  returns both the complete backups (`*.manifest.json`) and the part folders (`delimitedPrefixes`).

### 4. What is backed up

- Every `sqlite_master` table except `sqlite_%` and `_cf_%` (D1's internal tables refuse reads).
- **`d1_migrations` is included**, so a restored database keeps its migration history and later migrations still
  apply to it.
- `secrets` is included as ciphertext. Bank connections in a restored database work only with the same
  `SECRETS_ENCRYPTION_KEY`.
- Not backed up: the R2 objects themselves (plan-import and file-import uploads, which are temporary) and the
  Durable Object storage of `PlaidItemSync`.

### 5. Consistency

- The first invocation reads the counts and the first page of every table in **one `db.batch`**. D1 runs a batch as
  one transaction, so a backup that fits in one invocation is a consistent snapshot.
- A backup that spans invocations is consistent only page by page. D1 Time Travel stays the point-in-time net.
- If `max(d1_migrations.name)` changes during a backup (a deploy with a migration), the partial backup is abandoned
  and its folder deleted. The next invocation starts again.

### 6. Retention: N = 14

- `BACKUP_KEEP = 14`: two weeks of nightly backups. That is longer than D1 Time Travel's window on the Free plan
  (7 days) and still small for a personal plan.
- One backup = its manifest plus its folder. After a backup completes, pruning keeps the newest 14 manifests. It
  deletes older manifests with their folders, and any folder that is neither kept nor in progress (an abandoned
  partial).
- At most `BACKUP_PRUNE_PER_RUN = 3` backups are deleted per invocation (each takes one `list` and one
  `delete([...keys])`), so a backlog drains over a few runs. The steady state deletes one backup a night.

- Pruning also runs on a no-op invocation when the state says a backlog is left (`prune_pending`), so a backlog
  drains within the same night, not one set per night. That invocation costs: state get, prune list, up to
  3 × (list + delete), state put = 9 R2 calls.
- Write order at the end of a backup: last part, manifest, prune, then the state (`last_done`). If the state write
  fails, the next invocation redoes only the last read: part keys are fixed, so nothing is duplicated.

### 7. Limits: calls per backup invocation

| Invocation | D1 | R2 |
|---|---|---|
| no-op (done tonight, nothing in progress) | 0 | 1 (state get) |
| start | 2: schema read; one batch of counts + first pages | ≤ 12: state get, part put, manifest put, state put, prune list, 3 × (list + delete), status put |
| continue | 1: one batch (migration check + next pages) | same as start |
| abandon (schema changed) | 1 | 4: state get, folder list, delete, state put |

- Bounds: `BACKUP_MAX_D1_CALLS = 2`, `BACKUP_MAX_R2_CALLS = 12`. Total ≤ 14, far under 50, and the same whatever
  the number of rows. The counting test is `apps/worker/test/backup-calls.test.ts`.
- A page statement is `select rowid, "c1", … from "t" where rowid > ? order by rowid limit ?`: 2 bound values,
  no IN list.
- `BACKUP_ROWS_PER_RUN = 10,000` to start with, so a night's 12 invocations cover 120,000 rows. Anything beyond
  that carries over to the next night.
- Run size: `BACKUP_ROWS_PER_RUN` is split evenly over the tables not yet finished (at least 1 each, one extra row
  is asked for to see that a table is done), so the first invocation reads at most 400 rows per table; a table that
  is still unfinished then has the whole run to itself. A plan whose largest table exceeds 400 rows therefore takes
  a second invocation (5 minutes later). The batch is never larger than the run size (plus one row a table).
- Measured (the `backup-calls:` test line, local miniflare, so only an order of magnitude): an invocation that
  reads a 10,000-row table = about 160 ms, 2 D1 calls (start) or 1 (continue), 11 R2 calls at most (3 on a start with
  no pruning).

### 8. Failure and logs

- `backupRun` never throws. An error logs exactly one line, `backup failed | <describeError>`, cut to
  `LOG_LINE_MAX`. It holds no bound value, no row data and no environment value.
- A finished backup logs `backup done <id> tables=<n> rows=<n> parts=<n>`. An unfinished invocation logs
  `backup continuing <id> rows=<n>`.
- The backup runs in its own invocation, so a failed backup cannot affect enterDue or the sync (tested).

## Restore runbook

`scripts/restore-backup.sh` is the entry point. It checks its arguments in bash, then runs
`node --experimental-strip-types scripts/restore-backup.ts`. Wrangler runs as
`pnpm --filter @budget/worker exec wrangler … -c apps/worker/wrangler.jsonc`.

- `fetch <id> --out <dir>` downloads the manifest, then every part it lists.
- `restore --from <dir>` restores into the target:
  1. It checks the format, the version, and each part's sha256 and row count.
  2. It **refuses a target that already has an application table**.
  3. It writes one SQL file: `PRAGMA defer_foreign_keys = on;`, each `CREATE TABLE`, `INSERT … VALUES` chunks of
     at most 90 KB per statement (D1 allows 100 KB), then each `CREATE INDEX`.
  4. It runs the file with `wrangler d1 execute`, then compares every table's count with the manifest. It exits 0
     only when they all match.
  5. It prints table names and counts, never values.
- **Target guards** (exit 2, before any wrangler call):
  - `--remote` without `--confirm-remote-production` is refused;
  - no target is refused;
  - `--local` without an absolute `--persist-to` is refused, so the dev's own state is never touched by mistake.

### Local (tested: `scripts/test/restore-backup.test.ts`)

```bash
# 1. a local database and bucket that hold a backup (e.g. from pnpm dev's state, or a test's)
SRC=/abs/path/to/source-state
# 2. download the backup's manifest and parts from the local bucket
bash scripts/restore-backup.sh fetch 2026-11-25 --out /tmp/backup-2026-11-25 --local --persist-to "$SRC"
# 3. restore into an EMPTY local D1 (a new directory; no migrations applied first)
bash scripts/restore-backup.sh restore --from /tmp/backup-2026-11-25 --local --persist-to /tmp/restored-state
# prints "<table> <rows> ok" per table and exits 0 when every count matches the manifest
```

### Production: only with the owner's explicit approval

Nobody runs these commands without the owner approving that restore, at that time.

1. **First choice, within Time Travel's window:**
   `wrangler d1 time-travel restore budget-db --bookmark <bookmark from deploy.sh>` (or `--timestamp`).
2. **Otherwise, from a nightly backup:**
   - create a new, empty database: `wrangler d1 create budget-db-restore-<date>`;
   - `bash scripts/restore-backup.sh fetch <id> --out <dir> --remote --confirm-remote-production`;
   - `bash scripts/restore-backup.sh restore --from <dir> --remote --database budget-db-restore-<date> --confirm-remote-production`;
   - check the printed counts against the manifest;
   - with approval, point `d1_databases[0].database_id` at the new database and deploy.
   - The live `budget-db` is never the target: it is not empty, so the script refuses it.
3. The Worker needs the same `SECRETS_ENCRYPTION_KEY` as when the backup was taken.

## Live check after the deploy (read-only: keys and counts, no row data)

1. List the keys:
   `GET https://api.cloudflare.com/client/v4/accounts/<account>/r2/buckets/budget-files/objects?prefix=backups/d1/&delimiter=/`
   (with an API token that can read R2). After 04:00 UTC there is a `backups/d1/<today>.manifest.json`.
2. Print the manifest's counts only:

```bash
pnpm --filter @budget/worker exec wrangler r2 object get budget-files/backups/d1/<id>.manifest.json --remote --pipe \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log(m.id,m.finished_at,"parts="+m.parts.length);for(const t of m.tables)console.log(t.name,t.rows)})'
```

3. In the Worker's logs, the 04:00 invocation shows `backup done <id> tables=25 rows=… parts=…`. A
   `backup failed | …` line means the backup did not finish.

### 8. The outcome, and the warning in the app

- `backupRun` records its outcome in one small R2 object, `backups/d1/status.json` (`BACKUP_STATUS_KEY`, next to the
  manifests; no migration): `{ last_success_at, last_failure_at, last_error_code }`. A run that ends `done` puts it
  with `last_success_at` set and the failure fields null. A run that ends `failed` puts the object with the
  `last_success_at` it holds in the state file (`finish` stores it there; no get), the failure time and a short code (`read_failed`, `write_failed`, `finish_failed`,
  `failed`): no message, id, table or value. `noop`, `continuing` and `abandoned` write nothing. The write never
  changes the outcome and logs no more than one quiet line if it fails.
- Cost: one R2 put on the invocation that finishes a backup (`BACKUP_MAX_R2_CALLS` 11 to 12); a failed invocation adds one put
  (no get), so a failed run stays within the same bound. D1 calls are unchanged.
- `GET /api/v1/backup-status` and the MCP tool `get_backup_status` return `{ last_success_at, last_failure_at,
  last_error_code, stale }` from one R2 get; `stale` is no success in the last 36 hours (`BACKUP_STALE_HOURS`),
  also when nothing was ever recorded. They never read the backup's parts or manifests.
- The plans page (`/plans`) shows a small dismissible warning in the callout-warning tokens when `stale` is true
  or `last_error_code` is set. Dismissing lasts for the browser session and ends when the status changes.
