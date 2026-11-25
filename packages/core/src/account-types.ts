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

export const DISPLAY_GROUPS = ["cash", "credit", "loans", "tracking", "closed"] as const;
export type DisplayGroup = (typeof DISPLAY_GROUPS)[number];

const DISPLAY_OF: Record<AccountGroup, DisplayGroup> = {
  cash: "cash",
  credit: "credit",
  loan: "loans",
  tracking: "tracking",
};

/** The account's group as REST/MCP report it: "closed" for any closed account, else by type. */
export function displayGroup(type: AccountType, closed: boolean): DisplayGroup {
  return closed ? "closed" : DISPLAY_OF[accountGroup(type)];
}

export const SIDEBAR_SECTIONS = [
  "starred",
  "cash",
  "credit",
  "loans",
  "tracking",
  "closed",
] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];
export interface SidebarAccountLike {
  id: string;
  name: string;
  starred: boolean;
  closed: boolean;
  group: DisplayGroup;
  balance: number;
}

/** Non-empty sections in SIDEBAR_SECTIONS order; total = sum of balances, null for "closed". */
export function sidebarSections<T extends SidebarAccountLike>(
  accounts: readonly T[],
): { name: SidebarSection; rows: T[]; total: number | null }[] {
  const out: { name: SidebarSection; rows: T[]; total: number | null }[] = [];
  for (const name of SIDEBAR_SECTIONS) {
    let rows: T[];
    if (name === "starred") rows = accounts.filter((a) => a.starred && !a.closed);
    else if (name === "closed") {
      rows = accounts
        .filter((a) => a.closed)
        .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    } else rows = accounts.filter((a) => !a.closed && a.group === name);
    if (rows.length === 0) continue;
    out.push({
      name,
      rows,
      total: name === "closed" ? null : rows.reduce((n, a) => n + a.balance, 0),
    });
  }
  return out;
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

/** EXF-547 names: thin aliases over the rules above. */
export const accountKind = accountGroup;
export const signedOpeningBalance = startingBalanceAmount;

/** Loans and Asset/Liability accounts take no register category; Ready to Assign sees only cash Starting Balances. */
export const affectsReadyToAssign = startingBalanceFeedsReadyToAssign;

export type CategoryNeed = "required" | "not_needed" | "none";

/**
 * Whether a transaction needs a category. `account` is the row's own type; `counterpart` the type on the
 * other side of a transfer. Off-plan accounts (tracking, loan) never have one; an on-plan to on-plan
 * transfer needs none; an on-plan to off-plan transfer needs one on the on-plan side.
 */
export function requiresCategory(account: AccountType, counterpart?: AccountType): CategoryNeed {
  if (!isOnBudget(account)) return "none";
  if (counterpart && isOnBudget(counterpart)) return "not_needed";
  return "required";
}

export const CLEARED_STATUSES = ["uncleared", "cleared", "reconciled"] as const;
export type ClearedStatus = (typeof CLEARED_STATUSES)[number];
