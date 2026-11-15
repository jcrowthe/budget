export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "creditCard",
  "lineOfCredit",
  "mortgage",
  "autoLoan",
  "studentLoan",
  "personalLoan",
  "medicalDebt",
  "otherDebt",
  "otherAsset",
  "otherLiability",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const CREDIT_ACCOUNT_TYPES: readonly AccountType[] = ["creditCard", "lineOfCredit"];

export const CLEARED_STATUSES = ["uncleared", "cleared", "reconciled"] as const;
export type ClearedStatus = (typeof CLEARED_STATUSES)[number];
