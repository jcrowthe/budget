import { z } from "@hono/zod-openapi";
import { IsoDate, IsoDateTime, Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";

/** The window of the Plan toolbar's Recent Moves: "Previous 34 days of assigning and moving money". */
export const RECENT_MOVES_DAYS = 34;

export const RecentMoveSide = z
  .object({
    category_id: z.string(),
    category_name: z.string(),
    month: Month,
    deleted: z.boolean(),
  })
  .openapi("RecentMoveSide");

export const RecentMoveActor = z
  .object({ id: z.string(), name: z.string(), initial: z.string() })
  .openapi("RecentMoveActor");

export const RecentMove = z
  .object({
    id: z.string().openapi({ description: "The move's id, or the history row's id for an edit" }),
    at: IsoDateTime,
    actor: RecentMoveActor,
    kind: z.enum(["assigned", "removed", "moved"]),
    amount: Milliunits.positive(),
    from: RecentMoveSide.nullable(),
    to: RecentMoveSide.nullable(),
    method: z.enum(["edit", "move", "cover", "auto_assign", "undo"]),
    from_move: z.boolean().openapi({
      description:
        "True when the entry comes from a move record (Move, Cover, Assign Manually, or their undo)",
    }),
    undo_of: z.string().nullable(),
  })
  .openapi("RecentMove");

export const RecentMovesResponse = dataEnvelope(z.array(RecentMove)).openapi("RecentMovesResponse");

export const RecentMovesType = z.enum(["all", "moved", "assigned"]);

const Since = z.union([IsoDate, IsoDateTime]).refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "Expected a date (YYYY-MM-DD) or an ISO 8601 date-time",
});

export const RecentMovesQuery = z.object({
  since: Since.optional().openapi({
    param: { name: "since", in: "query" },
    description: "YYYY-MM-DD (that day, 00:00 UTC) or an ISO 8601 date-time; default 34 days ago",
  }),
  type: RecentMovesType.default("all").openapi({ param: { name: "type", in: "query" } }),
});

export type RecentMove = z.infer<typeof RecentMove>;
export type RecentMovesType = z.infer<typeof RecentMovesType>;

/** Moved: a move record whose source is a category. Assigned: everything else. All: both. */
export function matchesType(
  e: Pick<RecentMove, "from" | "from_move">,
  type: RecentMovesType,
): boolean {
  if (type === "all") return true;
  const moved = e.from_move && e.from !== null;
  return type === "moved" ? moved : !moved;
}

/** `user:a@b`, `mcp:user:a@b` -> "a"; `service:x`, `mcp:service:x` -> "x"; anything else as it is. */
export function actorName(actor: string): { name: string; initial: string } {
  const bare = actor.replace(/^mcp:/, "");
  let name = bare;
  if (bare.startsWith("user:")) name = bare.slice(5).split("@")[0] ?? bare;
  else if (bare.startsWith("service:")) name = bare.slice(8);
  if (name === "") name = actor;
  return { name, initial: (name.charAt(0) || "?").toUpperCase() };
}

const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Entries (newest first) grouped by local day: "Nov 15, 2026", today flagged. */
export function dayGroups(
  entries: RecentMove[],
  now: Date,
): { key: string; label: string; today: boolean; entries: RecentMove[] }[] {
  const out: { key: string; label: string; today: boolean; entries: RecentMove[] }[] = [];
  for (const e of entries) {
    const d = new Date(e.at);
    const key = dayKey(d);
    const last = out[out.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else out.push({ key, label: dayLabel(d), today: key === dayKey(now), entries: [e] });
  }
  return out;
}

/** The card's words before its category chips: "assigned $1.00 to", "removed $1.00 from", "moved $1.00 from" + "to". */
export function entryText(
  e: Pick<RecentMove, "kind" | "amount">,
  money: (n: number) => string,
): { lead: string; between: string | null } {
  const amount = money(e.amount);
  if (e.kind === "assigned") return { lead: `assigned ${amount} to`, between: null };
  if (e.kind === "removed") return { lead: `removed ${amount} from`, between: null };
  return { lead: `moved ${amount} from`, between: "to" };
}
