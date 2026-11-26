import { useState } from "react";
import { useBackupStatus } from "../api/backup-status";

/** Dismissed for the browser session; a new failure or success changes the key and shows it again. */
const dismissedKey = (s: { last_success_at: string | null; last_failure_at: string | null }) =>
  `backup-warning-dismissed:${s.last_success_at ?? "-"}:${s.last_failure_at ?? "-"}`;

/** A small warning when the nightly backup failed or has not succeeded in 36 hours; nothing otherwise. */
export function BackupWarning() {
  const { data } = useBackupStatus();
  const [, redraw] = useState(0);
  if (!data || (!data.stale && !data.last_error_code)) return null;
  const key = dismissedKey(data);
  if (sessionStorage.getItem(key)) return null;
  const text =
    data.last_error_code === "prune_failed"
      ? "Last night's backup finished, but old backups could not be removed."
      : data.last_error_code
        ? "The last backup failed. Your plans are safe, but the nightly backup needs attention."
        : "No backup in the last 36 hours. Your plans are safe, but the nightly backup needs attention.";
  return (
    <section className="backup-warning" role="status" aria-label="Backup warning">
      <p>{text}</p>
      <button
        type="button"
        className="backup-warning-dismiss"
        onClick={() => {
          sessionStorage.setItem(key, "1");
          redraw((n) => n + 1);
        }}
      >
        Dismiss
      </button>
    </section>
  );
}
