import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";

/** The change set id in the path of the undo route. */
export const ChangeSetIdParam = z
  .uuid()
  .openapi({ param: { name: "change_set_id", in: "path" }, description: "A change set id" });

const ids = z.array(z.string()).max(50);

/** Where the surface should navigate after an undo (docs/undo-design.md, D6). */
export const UndoWhere = z
  .discriminatedUnion("surface", [
    z.object({
      surface: z.literal("register"),
      account_id: z.string(),
      transaction_ids: ids,
    }),
    z.object({ surface: z.literal("plan"), month: Month.nullable(), category_ids: ids }),
    z.object({ surface: z.literal("payees"), payee_ids: ids }),
  ])
  .openapi("UndoWhere");

export const UndoResult = z
  .object({
    change_set_id: z
      .uuid()
      .describe("The undo's own change set: equals the Budget-Change-Set header"),
    undone_change_set_id: z.uuid(),
    entities: z.number().int().min(0).describe("Entities reversed, after netting"),
    where: UndoWhere,
  })
  .openapi("UndoResult");

export const UndoResultResponse = dataEnvelope(UndoResult).openapi("UndoResultResponse");

/** The error names of the undo route and their texts. */
export const UNDO_ERRORS = {
  forbidden: "This change was made by someone else and can't be undone here",
  already_undone: "This change was already undone",
  undo_refused: "This change can't be undone",
  undo_stale: "Something changed after this action, so it can't be undone",
} as const;

export type UndoWhere = z.infer<typeof UndoWhere>;
export type UndoResult = z.infer<typeof UndoResult>;
