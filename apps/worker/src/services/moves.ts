import { type MoveResult, READY_TO_ASSIGN } from "@budget/schema/moves";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "../env";
import { Conflict, NotFound } from "../middleware/errors";
import { getPlanMonth, MoveStale, moveMoney } from "./months";

const isUuid = (s: string) => z.uuid().safeParse(s).success;

type Kind = "move" | "cover";

function unprocessable(message: string): never {
  throw new HTTPException(422, { message });
}

async function moveInternal(
  env: Env,
  actor: string,
  input: { budget_id: string; month: string; from: string; to: string; amount: number },
  kind: Kind,
  expect?: { categoryId: string; assigned: number },
): Promise<MoveResult> {
  if (!isUuid(input.budget_id)) throw new NotFound("Plan");
  const side = (s: string) => {
    if (s === READY_TO_ASSIGN) return null;
    if (!isUuid(s)) throw new NotFound("Category");
    return s;
  };
  const from = side(input.from);
  const to = side(input.to);
  if (from === null && to === null) unprocessable("Both sides cannot be Ready to Assign");
  if (from === to) unprocessable("from and to must differ");
  const { move_id } = await moveMoney(
    env,
    actor,
    {
      budget_id: input.budget_id,
      month: input.month,
      from_category_id: from,
      to_category_id: to,
      amount: input.amount,
      kind,
    },
    expect,
  );
  const m = await getPlanMonth(env, input.budget_id, input.month);
  const cats = m.groups.flatMap((g) => g.categories);
  const amounts = (id: string | null) => {
    if (id === null) return null;
    const c = cats.find((x) => x.id === id);
    if (!c) throw new NotFound("Category");
    return {
      id: c.id,
      month: m.month,
      assigned: c.assigned,
      activity: c.activity,
      available: c.available,
    };
  };
  return {
    move_id,
    month: m.month,
    amount: input.amount,
    from: amounts(from),
    to: amounts(to),
    ready_to_assign: m.ready_to_assign,
  };
}

/** Moves money between two categories, or a category and Ready to Assign; answers with the new amounts. */
export const moveAndRead = (
  env: Env,
  actor: string,
  input: { budget_id: string; month: string; from: string; to: string; amount: number },
) => moveInternal(env, actor, input, "move");

/**
 * Moves exactly the overspent amount of a category from `from` into it. The amount comes from a read; the move
 * is guarded on the category's Assigned still being what that read saw, and a stale read is redone (so a second
 * concurrent cover finds Available 0 and answers 422).
 */
export async function coverAndRead(
  env: Env,
  actor: string,
  input: { budget_id: string; month: string; category_id: string; from: string },
): Promise<MoveResult> {
  if (!isUuid(input.budget_id)) throw new NotFound("Plan");
  if (!isUuid(input.category_id)) throw new NotFound("Category");
  for (let attempt = 0; attempt < 5; attempt++) {
    const m = await getPlanMonth(env, input.budget_id, input.month);
    const c = m.groups.flatMap((g) => g.categories).find((x) => x.id === input.category_id);
    if (!c) throw new NotFound("Category");
    if (c.available >= 0) unprocessable("Category is not overspent");
    if (input.from === input.category_id) unprocessable("Cannot cover a category from itself");
    try {
      return await moveInternal(
        env,
        actor,
        {
          budget_id: input.budget_id,
          month: input.month,
          from: input.from,
          to: input.category_id,
          amount: -c.available,
        },
        "cover",
        { categoryId: input.category_id, assigned: c.assigned },
      );
    } catch (e) {
      if (!(e instanceof MoveStale)) throw e;
    }
  }
  throw new Conflict("Category");
}
