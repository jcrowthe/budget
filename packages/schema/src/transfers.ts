/** What a row's category may be, given its own account and the account on the other side of a transfer. */
export type CategoryRule = "category" | "not_needed" | "none";

/**
 * - `none`: this side is a tracking account, it never has a category.
 * - `not_needed`: an on-plan to on-plan transfer takes no category and counts in no month figure.
 * - `category`: an on-plan row (plain, or the on-plan side of a transfer with a tracking account) may have one.
 */
export function transferCategoryRule(
  side: { on_budget: boolean },
  other: { on_budget: boolean } | null,
): CategoryRule {
  if (!side.on_budget) return "none";
  if (other?.on_budget) return "not_needed";
  return "category";
}

export const TRANSFER_PAYEE_PREFIX = "transfer:";
export const transferPayeeId = (accountId: string) => `${TRANSFER_PAYEE_PREFIX}${accountId}`;
/** The payee name (and title) of a transfer entry. */
export const transferPayeeName = (name: string) => `Transfer : ${name}`;
/** The label in the payee picker's "Payments and Transfers" section. */
export const transferPayeeLabel = (name: string) => `To/From ${name}`;
/** The payee text of a saved transfer row. */
export const transferCellText = (name: string) => `Transfer: ${name}`;
