import { z } from "@hono/zod-openapi";
import { IsoDate, Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";

/** The most rows one read sends; `total_count` and `activity` still cover every row. */
export const CATEGORY_ACTIVITY_LIMIT = 500;

export const CategoryActivityRow = z
  .object({
    id: z.string(),
    subtransaction_id: z.string().nullable(),
    account_id: z.string(),
    account_name: z.string(),
    date: IsoDate,
    payee_name: z.string().nullable(),
    memo: z.string().nullable(),
    amount: Milliunits,
  })
  .openapi("CategoryActivityRow");

export const CategoryActivity = z
  .object({
    category_id: z.string(),
    month: Month,
    activity: Milliunits,
    total_count: z.number().int().nonnegative(),
    transactions: z.array(CategoryActivityRow),
  })
  .openapi("CategoryActivity");

export const CategoryActivityResponse = dataEnvelope(CategoryActivity).openapi(
  "CategoryActivityResponse",
);

export type CategoryActivityRow = z.infer<typeof CategoryActivityRow>;
export type CategoryActivity = z.infer<typeof CategoryActivity>;

/** "N more transactions not shown." (1: "1 more transaction not shown."); null when nothing is cut. */
export function activityMoreText(
  a: Pick<CategoryActivity, "total_count" | "transactions">,
): string | null {
  const n = a.total_count - a.transactions.length;
  if (n <= 0) return null;
  return n === 1 ? "1 more transaction not shown." : `${n} more transactions not shown.`;
}

/** The Activity button's title. */
export const activityTitle = (amountText: string) =>
  `(${amountText}) View this category's monthly activity.`;
