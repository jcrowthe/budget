import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { MonthCategoryAmounts } from "./month-categories";

export const READY_TO_ASSIGN = "ready_to_assign" as const;

export const MoveSide = z
  .string()
  .min(1)
  .openapi({ description: 'A category id, or "ready_to_assign"' });

export const MoveCreate = z
  .object({ from: MoveSide, to: MoveSide, amount: Milliunits.positive() })
  .refine((v) => v.from !== v.to, { message: "from and to must differ" })
  .openapi("MoveCreate");

export const CoverCreate = z.object({ from: MoveSide }).openapi("CoverCreate");

export const MoveResult = z
  .object({
    move_id: z.uuid(),
    month: Month,
    amount: Milliunits,
    from: MonthCategoryAmounts.nullable(),
    to: MonthCategoryAmounts.nullable(),
    ready_to_assign: Milliunits,
  })
  .openapi("MoveResult");

export const MoveResultResponse = dataEnvelope(MoveResult).openapi("MoveResultResponse");

export type MoveCreate = z.infer<typeof MoveCreate>;
export type CoverCreate = z.infer<typeof CoverCreate>;
export type MoveResult = z.infer<typeof MoveResult>;
