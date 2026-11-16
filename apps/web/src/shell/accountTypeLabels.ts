import type { AccountType, SidebarSection } from "@budget/core/account-types";

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  creditCard: "Credit Card",
  lineOfCredit: "Line of Credit",
  mortgage: "Mortgage",
  autoLoan: "Auto Loan",
  studentLoan: "Student Loan",
  personalLoan: "Personal Loan",
  medicalDebt: "Medical Debt",
  otherDebt: "Other Debt",
  otherAsset: "Asset (e.g. Investment)",
  otherLiability: "Liability",
};

export const ACCOUNT_TYPE_GROUPS: { heading: string; description: string; types: AccountType[] }[] =
  [
    {
      heading: "Cash Accounts",
      description: "A cash account holds funds you already own and can spend immediately.",
      types: ["checking", "savings", "cash"],
    },
    {
      heading: "Credit Accounts",
      description:
        "A credit account lets you spend borrowed money that you'll need to repay later, often with interest.",
      types: ["creditCard", "lineOfCredit"],
    },
    {
      heading: "Mortgages and Loans",
      description:
        "Accounts that have an outstanding balance you're currently paying off, and aren't spending from.",
      types: ["mortgage", "autoLoan", "studentLoan", "personalLoan", "medicalDebt", "otherDebt"],
    },
    {
      heading: "Tracking Accounts",
      description:
        "Accounts that hold money you don't plan to spend soon, such as investments or loans.",
      types: ["otherAsset", "otherLiability"],
    },
  ];

/** The account page's type badge. */
export const ACCOUNT_BADGE: Partial<Record<AccountType, string>> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  creditCard: "Credit Card",
  lineOfCredit: "Line of Credit",
  otherAsset: "Tracking Account: Asset",
  otherLiability: "Tracking Account: Liability",
};

export const SIDEBAR_LABELS: Record<SidebarSection, string> = {
  starred: "STARRED",
  cash: "CASH",
  credit: "CREDIT",
  loans: "LOANS",
  tracking: "TRACKING",
  closed: "CLOSED",
};
