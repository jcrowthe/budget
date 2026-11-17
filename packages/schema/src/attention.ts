// What needs the person's attention in a register: the Worker's `needsAttention()` SQL, row by row, and the
// words of the banner, the chip and the pill's tooltip.

export type AttentionTx = {
  approved: boolean;
  category_id: string | null;
  inflow_to_ready_to_assign: boolean;
  subtransactions?: readonly unknown[];
  transfer_account_id: string | null;
  payee_system?: string | null;
};

/** Unapproved, or (on a plan account) without a category when one is expected. */
export function needsAttention(
  tx: AttentionTx,
  account: { on_budget: boolean },
  transferAccount: { on_budget: boolean } | null,
): boolean {
  if (!tx.approved) return true;
  return (
    account.on_budget &&
    !tx.category_id &&
    !tx.inflow_to_ready_to_assign &&
    !tx.subtransactions?.length &&
    !(tx.transfer_account_id && transferAccount?.on_budget) &&
    tx.payee_system !== "starting_balance"
  );
}

/** Unapproved, imported, not a transfer: the bar's Reject rule for one row. */
export function canReject(tx: {
  approved: boolean;
  import_id: string | null;
  source: string | null;
  transfer_account_id: string | null;
}): boolean {
  return !tx.approved && tx.import_id !== null && tx.source !== null && !tx.transfer_account_id;
}

/** Sum of needs_attention_count over the given (open) accounts. */
export function attentionTotal(accounts: readonly { needs_attention_count?: number }[]): number {
  return accounts.reduce((n, a) => n + (a.needs_attention_count ?? 0), 0);
}

export function attentionBannerText(n: number): string {
  return n === 1
    ? "1 new transaction to approve or categorize."
    : `${n} new transactions to approve or categorize.`;
}

export const ATTENTION_FILTER_LABEL = "Unapproved or Uncategorized";
export const NEEDS_CATEGORY_TIP =
  "Assign a category to this transaction so you'll know what you spent your money on.";
export const NEEDS_APPROVAL_LABEL = "This transaction needs approval";
