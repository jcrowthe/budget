/**
 * The nightly D1 backup to R2 (EXF-976; docs/backup-design.md). Constants and the shapes of what it writes.
 * No zod: there is no route; the manifest is read by the restore script and the tests.
 */

/** Its own cron: 04:00 to 04:55 UTC, twelve invocations, so a backup never takes calls from the scheduler or the sync. */
export const BACKUP_CRON = "*/5 4 * * *";
export const BACKUP_PREFIX = "backups/d1/";
export const BACKUP_STATE_KEY = `${BACKUP_PREFIX}state.json`;
export const BACKUP_FORMAT = "budget-d1-backup";
export const BACKUP_FORMAT_VERSION = 1;
/** Retention N: the newest 14 nightly sets are kept. */
export const BACKUP_KEEP = 14;
/** Sets deleted per invocation (each one R2 list and one delete). */
export const BACKUP_PRUNE_PER_RUN = 3;
/** Rows one invocation reads. */
export const BACKUP_ROWS_PER_RUN = 10_000;
/** Bounds per invocation, asserted by apps/worker/test/backup-calls.test.ts. */
export const BACKUP_MAX_D1_CALLS = 2;
export const BACKUP_MAX_R2_CALLS = 11;

export interface BackupColumn {
  name: string;
  type: string;
  pk: number;
}

export interface BackupTable {
  name: string;
  sql: string;
  columns: BackupColumn[];
  /** The INTEGER PRIMARY KEY column that is the rowid, or null. */
  rowid_alias: string | null;
  rows: number;
}

export interface BackupIndex {
  name: string;
  table: string;
  sql: string;
}

export interface BackupPart {
  key: string;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  format_version: number;
  id: string;
  started_at: string;
  finished_at: string;
  schema_version: string;
  deploy_sha: string;
  tables: BackupTable[];
  indexes: BackupIndex[];
  parts: BackupPart[];
  rows_total: number;
}

export interface BackupState {
  in_progress: null | {
    id: string;
    started_at: string;
    schema_version: string;
    tables: BackupTable[];
    indexes: BackupIndex[];
    /** The last rowid read per table. */
    cursors: Record<string, number>;
    /** Rows written per table so far. */
    counts: Record<string, number>;
    done: string[];
    parts: BackupPart[];
  };
}
