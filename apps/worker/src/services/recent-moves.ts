import {
  actorName,
  matchesType,
  RECENT_MOVES_DAYS,
  type RecentMove,
  RecentMovesQuery,
} from "@budget/schema/recent-moves";
import { z } from "zod";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import { listMoveRows, type MoveRow } from "../repositories/recent-moves";

/** Test seam: the time the default window counts back from. */
export const recentMovesClock = { now: () => new Date() };

const isUuid = (s: string) => z.uuid().safeParse(s).success;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` is that day at 00:00 UTC; a date-time is used as given. Always an ISO string with milliseconds. */
const sinceIso = (since: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00.000Z` : since).toISOString();

function toEntry(r: MoveRow, actor: string): RecentMove {
  const side = (id: string | null, name: string | null, deleted: number | null) =>
    id === null
      ? null
      : {
          category_id: id,
          category_name: name ?? "",
          month: r.month,
          deleted: !!deleted,
        };
  const from = side(r.from_id, r.from_name, r.from_deleted);
  const to = side(r.to_id, r.to_name, r.to_deleted);
  const method: RecentMove["method"] =
    r.move_id !== null
      ? r.move_kind === "cover" || r.move_kind === "undo"
        ? r.move_kind
        : "move"
      : r.auto_assign
        ? "auto_assign"
        : r.undo_of
          ? "undo"
          : "edit";
  return {
    id: r.id,
    at: r.at,
    actor: { id: actor, ...actorName(actor) },
    kind: from && to ? "moved" : from ? "removed" : "assigned",
    amount: r.amount,
    from,
    to,
    method,
    from_move: r.move_id !== null,
    undo_of: r.move_id !== null ? r.move_undo_of : r.undo_of,
  };
}

/**
 * The plan's recent assigning and money moves, newest first: 2 D1 calls (the plan check and one list
 * query), whatever the number of moves.
 */
export async function listRecentMoves(
  env: Env,
  _actor: string,
  input: { budget_id: string; since?: string; type?: string },
): Promise<RecentMove[]> {
  const q = RecentMovesQuery.parse({ since: input.since, type: input.type });
  if (!isUuid(input.budget_id)) throw new NotFound("Plan");
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, input.budget_id))) throw new NotFound("Plan");
  const since = q.since
    ? sinceIso(q.since)
    : new Date(recentMovesClock.now().getTime() - RECENT_MOVES_DAYS * DAY_MS).toISOString();
  const rows = await listMoveRows(db, input.budget_id, since);
  return rows.map((r) => toEntry(r, r.actor)).filter((e) => matchesType(e, q.type));
}
