import { RecentMovesType } from "@budget/schema/recent-moves";
import { z } from "zod";
import { listRecentMoves } from "../../services/recent-moves";
import { dates, Id, MONEY, MONTH, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_recent_moves",
    description: `List a plan's recent assigning and money moves, newest first: the changes to Assigned of the last 34 days (or since 'since'), in every month. Each entry is one change: a direct edit of Assigned, an Auto-Assign, a move or cover (one entry for both sides), or the undo of one. type 'moved' lists the moves from a category (to another category or to Ready to Assign); 'assigned' lists the rest (edits, Auto-Assign, money assigned from Ready to Assign, and undos of edits); 'all' (default) both. A category deleted since keeps its name with deleted true; a category-delete merge is not listed. ${MONEY} The amount is positive. ${dates("since")} Since is a date (that day, 00:00 UTC) or an ISO 8601 date-time. category_id keeps the entries to or from that category (a move whole); month (${MONTH}) keeps that month's changes and, without since, has no 34-day window. ${timestamps(["at"])} Returns { moves: [{ id, at, actor: { id, name, initial }, kind (assigned, removed or moved), amount, from, to, method (edit, move, cover, auto_assign, undo or redo; a redo is the undo of an undo), from_move, undo_of }] }; from and to are { category_id, category_name, month, deleted } or null for Ready to Assign (or no side).`,
    inputSchema: z.object({
      budget_id: Id,
      since: z.string().min(1).optional(),
      type: RecentMovesType.optional(),
      category_id: Id.optional(),
      month: z.string().min(1).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        since?: string;
        type?: "all" | "moved" | "assigned";
        category_id?: string;
        month?: string;
      },
      { env, actor },
    ) => ({ moves: await listRecentMoves(env, actor, input) }),
  },
];
