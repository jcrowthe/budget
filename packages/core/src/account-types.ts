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
export const LOAN_ACCOUNT_TYPES: readonly AccountType[] = [
  "mortgage",
  "autoLoan",
  "studentLoan",
  "personalLoan",
  "medicalDebt",
  "otherDebt",
];

/** The payee text that marks the transaction every new account starts with. */
export const STARTING_BALANCE_PAYEE = "Starting Balance";

export type AccountGroup = "cash" | "credit" | "loan" | "tracking";

export function accountGroup(type: AccountType): AccountGroup {
  if (type === "checking" || type === "savings" || type === "cash") return "cash";
  if (CREDIT_ACCOUNT_TYPES.includes(type)) return "credit";
  if (LOAN_ACCOUNT_TYPES.includes(type)) return "loan";
  return "tracking";
}

export function isLoanType(type: AccountType): boolean {
  return accountGroup(type) === "loan";
}

/** On the plan (feeds the budget) rather than tracking only. Loans are decided by EXF-482/547. */
export function isOnBudget(type: AccountType): boolean {
  const g = accountGroup(type);
  return g === "cash" || g === "credit";
}

/** True when a positive number entered for the account means money owed. */
export function positiveMeansOwed(type: AccountType): boolean {
  return accountGroup(type) !== "cash" && type !== "otherAsset";
}

/** The Starting Balance amount stored for an entered balance (never -0). */
export function startingBalanceAmount(type: AccountType, entered: number): number {
  if (entered === 0) return 0;
  return positiveMeansOwed(type) ? -entered : entered;
}

/** Only an on-plan cash account's Starting Balance is an inflow to Ready to Assign. */
export function startingBalanceFeedsReadyToAssign(type: AccountType): boolean {
  return accountGroup(type) === "cash";
}

export const CLEARED_STATUSES = ["uncleared", "cleared", "reconciled"] as const;
export type ClearedStatus = (typeof CLEARED_STATUSES)[number];
