import { BackupStatusResponse } from "@budget/schema/backup-status";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { readBackupStatus } from "../services/backup-status";

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const getBackupStatus = createRoute({
  method: "get",
  path: "/backup-status",
  tags: ["Backup"],
  summary: "The nightly backup's last success and failure",
  responses: {
    200: json(
      BackupStatusResponse,
      "The last success and last failure of the nightly backup, a short failure code, and stale (no success in 36 hours)",
    ),
    403: json(ErrorBody, "Forbidden"),
  },
});

export default new OpenAPIHono<AppEnv>().openapi(getBackupStatus, async (c) =>
  c.json({ data: await readBackupStatus(c.env) }, 200),
);
