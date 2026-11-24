import { ChangeSetIdParam, UndoResultResponse } from "@budget/schema/changes";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { UndoRefused, undoChangeSet } from "../services/undo";

const tags = ["Changes"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        422,
        "unprocessable_entity",
        result.error.issues.map((i) => i.message).join("; "),
      );
    }
  },
});

export default app.openapi(
  createRoute({
    method: "post",
    path: "/budgets/{budget_id}/changes/{change_set_id}/undo",
    tags,
    summary: "Undo a change set",
    description:
      "Reverses everything one change set wrote, atomically, and refuses (409, nothing written) when an entity changed since. Redo is the undo of the undo's own set (`data.change_set_id`).",
    request: {
      params: z.object({
        budget_id: z
          .string()
          .min(1)
          .openapi({ param: { name: "budget_id", in: "path" } }),
        change_set_id: ChangeSetIdParam,
      }),
    },
    responses: {
      200: json(UndoResultResponse, "The undo's own change set and where the change was made"),
      403: json(ErrorBody, "The set was written by someone else (another user, MCP, a sync)"),
      404: json(ErrorBody, "The plan or the change set was not found"),
      409: json(
        ErrorBody,
        "already_undone, undo_refused (the set holds something that can't be undone) or undo_stale (something changed since)",
      ),
      422: json(ErrorBody, "The change set id is not a UUID"),
    },
  }),
  async (c) => {
    const { budget_id, change_set_id } = c.req.valid("param");
    try {
      const data = await undoChangeSet(c.env, c.get("identity").actor, budget_id, change_set_id);
      return c.json({ data }, 200);
    } catch (e) {
      if (e instanceof UndoRefused)
        return c.json(
          { error: { id: String(e.status), name: e.code, detail: e.message } },
          e.status,
        );
      throw e;
    }
  },
);
