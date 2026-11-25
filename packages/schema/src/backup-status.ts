import { z } from "@hono/zod-openapi";
import { BACKUP_PREFIX } from "./backup";
import { dataEnvelope } from "./common/envelope";

/**
 * The nightly backup's outcome (docs/backup-design.md): one small R2 object next to the manifests, written by
 * the backup run and read by GET /backup-status. It holds timestamps and a short code, never data.
 */
export const BACKUP_STATUS_KEY = `${BACKUP_PREFIX}status.json`;
/** No success for this long is stale. */
export const BACKUP_STALE_HOURS = 36;

/** Where a failed run stopped: reading the schema or the rows, writing a part, or finishing (manifest, prune, state). */
export const BackupErrorCode = z.enum(["read_failed", "write_failed", "finish_failed", "failed"]);
export type BackupErrorCode = z.infer<typeof BackupErrorCode>;

/** The stored object. */
export const BackupStatusFile = z.object({
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  last_error_code: BackupErrorCode.nullable(),
});
export type BackupStatusFile = z.infer<typeof BackupStatusFile>;

export const BackupStatus = BackupStatusFile.extend({
  stale: z.boolean().openapi({
    description: `True when there was no success in the last ${BACKUP_STALE_HOURS} hours.`,
  }),
}).openapi("BackupStatus", {
  description:
    "The nightly backup's last success and last failure (ISO 8601; null when none is recorded), a short failure code, and whether the backup is stale.",
});
export const BackupStatusResponse = dataEnvelope(BackupStatus).openapi("BackupStatusResponse");
export type BackupStatus = z.infer<typeof BackupStatus>;
