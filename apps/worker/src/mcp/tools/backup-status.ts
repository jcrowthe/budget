import { z } from "zod";
import { readBackupStatus } from "../../services/backup-status";
import { timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "get_backup_status",
    description: `Get the nightly backup's status: whether it ran and whether it failed. Reads one small status record; it never reads or returns any backup content. ${timestamps(["last_success_at", "last_failure_at"])} Returns { last_success_at, last_failure_at, last_error_code, stale }: the last successful backup and the last failed run (each null when none is recorded; a success clears the failure), a short failure code (read_failed, write_failed, finish_failed or failed; null when the last run did not fail), and stale, true when there was no successful backup in the last 36 hours (also when none was ever recorded).`,
    inputSchema: z.object({}),
    run: async (_input: Record<string, never>, { env }) => readBackupStatus(env),
  },
];
