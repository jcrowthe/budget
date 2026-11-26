import {
  BACKUP_STALE_HOURS,
  BACKUP_STATUS_KEY,
  type BackupErrorCode,
  type BackupStatus,
  BackupStatusFile,
} from "@budget/schema/backup-status";
import type { Env } from "../env";

// The nightly backup's outcome (docs/backup-design.md): one R2 object, timestamps and a short code only.

const EMPTY: BackupStatusFile = {
  last_success_at: null,
  last_failure_at: null,
  last_error_code: null,
};

/** One R2 get. A missing or unreadable object is "nothing recorded". */
async function readFile(env: Env): Promise<BackupStatusFile> {
  const o = await env.FILES.get(BACKUP_STATUS_KEY);
  if (!o) return EMPTY;
  try {
    const p = BackupStatusFile.safeParse(await o.json());
    return p.success ? p.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The read of GET /backup-status and the MCP tool: constant cost, one R2 get, no backup content. */
export async function readBackupStatus(env: Env, now: Date = new Date()): Promise<BackupStatus> {
  const s = await readFile(env);
  const ok = s.last_success_at ? Date.parse(s.last_success_at) : Number.NaN;
  const stale = !(now.getTime() - ok <= BACKUP_STALE_HOURS * 3600_000);
  return { ...s, stale };
}

/** A success: one put. The failure fields reset, because the backup works again. */
export async function recordBackupSuccess(env: Env, now: Date): Promise<void> {
  await env.FILES.put(
    BACKUP_STATUS_KEY,
    JSON.stringify({
      last_success_at: now.toISOString(),
      last_failure_at: null,
      last_error_code: null,
    }),
  );
}

/**
 * A failure: one put, no get. The caller passes the last success it already holds (the state file, read at the
 * start of the run); it is null when the run failed before that read, and then R2 is the likely cause.
 */
export async function recordBackupFailure(
  env: Env,
  now: Date,
  code: BackupErrorCode,
  lastSuccessAt: string | null,
): Promise<void> {
  await env.FILES.put(
    BACKUP_STATUS_KEY,
    JSON.stringify({
      last_success_at: lastSuccessAt,
      last_failure_at: now.toISOString(),
      last_error_code: code,
    }),
  );
}
