import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { STATUS_REASONS } from "./plaid-import";
import { AccountBalances, isCalendarDate, Transaction } from "./transactions";

// Repeats core's ACCOUNT_TYPES (schema does not depend on core); a Worker test asserts they are equal.
export const AccountType = z
  .enum([
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
  ])
  .openapi("AccountType");

// Repeats core's DISPLAY_GROUPS; a Worker test asserts they are equal.
export const AccountGroup = z
  .enum(["cash", "credit", "loans", "tracking", "closed"])
  .openapi("AccountGroup");

export const Account = z
  .object({
    id: z.uuid(),
    budget_id: z.uuid(),
    name: z.string(),
    type: AccountType,
    on_budget: z.boolean(),
    note: z.string().nullable(),
    starred: z.boolean(),
    closed: z.boolean(),
    group: AccountGroup,
    sort: z.number().int(),
    created_at: z.string(),
    cleared_balance: Milliunits,
    uncleared_balance: Milliunits,
    balance: Milliunits,
    bank_account_id: z.uuid().nullable().openapi({
      description: "The bank account this account is linked to; null when it is not linked",
    }),
    linked: z
      .boolean()
      .openapi({ description: "True when the account is linked to a bank account" }),
    import_start_date: IsoDate.nullable().openapi({
      description:
        "The first date a bank import may bring in (YYYY-MM-DD); null when the account is not linked",
    }),
    last_reconciled_at: z.string().nullable().openapi({
      description:
        "When the account was last reconciled (ISO 8601 UTC); null before the first reconcile",
    }),
    can_delete: z.boolean().openapi({
      description:
        "True when DELETE would succeed: an open account whose only transaction is its Starting Balance (or none), a closed account with no transactions",
    }),
    unapproved_count: z.number().int().min(0).default(0).openapi({
      description: "Live transactions of the account that are not approved yet (imports to review)",
    }),
    needs_attention_count: z.number().int().min(0).default(0).openapi({
      description:
        "Live transactions that are unapproved or need a category (an on-plan account, no category, not Ready to Assign, not a split or an on-plan transfer or a Starting Balance)",
    }),
    connection_status: z
      .enum(["connected", "delayed", "login_required", "broken"])
      .nullable()
      .default(null)
      .openapi({
        description:
          "Status of the linked account's bank connection: connected, delayed, login_required or broken; null when not linked",
      }),
    last_synced_at: z.string().nullable().default(null).openapi({
      description:
        "When the linked account's bank connection last synced (ISO 8601 UTC); null when not linked or never synced",
    }),
    connection_reason: z.enum(STATUS_REASONS).nullable().default(null).openapi({
      description:
        "Why the linked account's bank connection is in its status, for the words only: unavailable (delayed: the bank cannot be reached through the import service for now), unsupported (delayed: the import service no longer supports the bank), reauthorize (login_required: the bank asks the owner to authorize again); null otherwise, and null when not linked",
    }),
    link_missing_since: z.string().nullable().default(null).openapi({
      description:
        "When the bank first stopped listing this linked account's bank account (ISO 8601 UTC): the account reads Linked Account Not Found and imports to it have stopped. Null when the bank lists it, and null when the account is not linked",
    }),
    interest_rate: z.string().nullable().default(null).openapi({
      description:
        'A loan account\'s annual interest rate in percent, as a decimal string ("6.5", "0"); null for every other account',
    }),
    minimum_payment: Milliunits.nullable().default(null).openapi({
      description:
        "A loan account's required monthly payment in milliunits, as the lender asks it (principal, interest, escrow, fees); null for every other account",
    }),
    escrow_amount: Milliunits.nullable().default(null).openapi({
      description:
        "A loan account's monthly escrow or fees in milliunits (0 when none); null for every other account",
    }),
    paired_category_id: z.string().nullable().default(null).openapi({
      description:
        "The plan category the loan is paired with; null when none, and null for every other account",
    }),
  })
  .openapi("Account");

export const AccountCreate = z
  .object({
    budget_id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    type: AccountType,
    on_budget: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .openapi("AccountCreate");

export const PlanDate = IsoDate.regex(
  /^(19|20|21)\d{2}-/,
  "Year must be between 1900 and 2199",
).refine(isCalendarDate, "date must be a real calendar date");

// Repeats core's LOAN_ACCOUNT_TYPES (schema does not depend on core); a Worker test asserts they are equal.
const LOAN_TYPES: readonly string[] = [
  "mortgage",
  "autoLoan",
  "studentLoan",
  "personalLoan",
  "medicalDebt",
  "otherDebt",
];

/** A percent as a decimal string: 1-3 integer digits, up to 3 fraction digits, 0 to 100. */
export const InterestRate = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, "interest_rate must be a decimal string such as 6.5")
  .refine((v) => {
    const [int = "", frac = ""] = v.split(".");
    return Number(int) < 100 || (Number(int) === 100 && /^0*$/.test(frac));
  }, "interest_rate must be between 0 and 100")
  .openapi({
    description: "Annual interest rate in percent as a decimal string, 0 to 100, up to 3 decimals",
    example: "6.5",
  });

/** "06.50" → "6.5", "0.0" → "0": string operations only, never a float. */
export function canonicalInterestRate(v: string): string {
  const [int = "0", frac = ""] = v.split(".");
  const i = int.replace(/^0+(?=\d)/, "");
  const f = frac.replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

const pairName = z.string().trim().min(1, "name is required").max(100);

export const LoanNewCategory = z
  .object({
    name: pairName,
    group_id: z.string().min(1).optional(),
    new_group_name: pairName.optional(),
  })
  .refine((o) => (o.group_id === undefined) !== (o.new_group_name === undefined), {
    message: "new_category needs exactly one of group_id and new_group_name",
  })
  .openapi("LoanNewCategory", {
    description:
      "A category to create and pair with the loan: name, and either group_id (an existing group) or new_group_name (a new group created with it)",
  });

/** The POST fields without the cross-field rules, for the MCP tool's input shape. */
export const accountCreateFields = {
  name: z.string().trim().min(1, "Name is required").max(100),
  type: AccountType,
  balance: Milliunits,
  date: PlanDate.optional(),
  interest_rate: InterestRate.optional(),
  minimum_payment: Milliunits.min(0).optional().openapi({
    description: "Loan types only, required for them: the monthly payment the lender requires",
  }),
  escrow_amount: Milliunits.min(0).optional().openapi({
    description: "Loan types only: monthly escrow or fees in milliunits (stored 0 when absent)",
  }),
  paired_category_id: z.string().min(1).optional().openapi({
    description: "Loan types only: pair with this existing category (not with new_category)",
  }),
  new_category: LoanNewCategory.optional(),
};

export const AccountCreateRequest = z
  .object(accountCreateFields)
  .superRefine((o, ctx) => {
    const isLoan = LOAN_TYPES.includes(o.type);
    const loanFields = [
      "interest_rate",
      "minimum_payment",
      "escrow_amount",
      "paired_category_id",
      "new_category",
    ] as const;
    if (!isLoan) {
      for (const f of loanFields) {
        if (o[f] !== undefined) {
          ctx.addIssue({ code: "custom", path: [f], message: `${f} is only for loan accounts` });
        }
      }
      return;
    }
    for (const f of ["interest_rate", "minimum_payment"] as const) {
      if (o[f] === undefined) {
        ctx.addIssue({ code: "custom", path: [f], message: `${f} is required for loan accounts` });
      }
    }
    if (o.paired_category_id !== undefined && o.new_category !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["new_category"],
        message: "send paired_category_id or new_category, not both",
      });
    }
  })
  .openapi("AccountCreateRequest");

const accountUpdateFields = z
  .object({
    name: z.string().max(100).optional(),
    note: z.string().max(500).nullable().optional(),
    starred: z.boolean().optional(),
  })
  .strict();

/** The PATCH fields without the "at least one" rule, for the MCP tool's input shape. */
export const accountUpdateShape = accountUpdateFields.shape;

export const AccountUpdateRequest = accountUpdateFields
  .refine((o) => Object.keys(o).length > 0, "Nothing to update")
  .openapi("AccountUpdateRequest");

export const accountAdjustFields = { balance: Milliunits, today: PlanDate.optional() };

export const AccountAdjustBalanceRequest = z
  .object(accountAdjustFields)
  .strict()
  .openapi("AccountAdjustBalanceRequest");

export const accountCloseFields = { today: PlanDate.optional() };

export const AccountCloseRequest = z
  .object(accountCloseFields)
  .strict()
  .openapi("AccountCloseRequest");

export const MANUAL_ADJUSTMENT_PAYEE = "Manual Balance Adjustment";
export const CLOSED_ACCOUNT_MEMO = "Closed Account";

export const AccountLinkOverride = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100).optional(),
    type: AccountType.optional(),
  })
  .strict();

export const accountsFromBankFields = {
  bank_account_ids: z.array(z.string().min(1)).min(1).max(50),
  overrides: z.record(z.string(), AccountLinkOverride).optional(),
  today: PlanDate.optional(),
};

export const AccountsFromBankRequest = z
  .object(accountsFromBankFields)
  .strict()
  .refine((o) => new Set(o.bank_account_ids).size === o.bank_account_ids.length, {
    message: "bank_account_ids must not repeat",
  })
  .refine((o) => Object.keys(o.overrides ?? {}).every((k) => o.bank_account_ids.includes(k)), {
    message: "every override key must be one of bank_account_ids",
  })
  .openapi("AccountsFromBankRequest");

export const accountLinkFields = {
  bank_account_id: z.string().min(1),
  today: PlanDate.optional(),
};

export const AccountLinkRequest = z
  .object(accountLinkFields)
  .strict()
  .openapi("AccountLinkRequest");

export const AccountSummaryResponse = dataEnvelope(z.object({ balances: AccountBalances })).openapi(
  "AccountSummaryResponse",
);

export const AccountResponse = dataEnvelope(z.object({ account: Account })).openapi(
  "AccountResponse",
);
/** The ids of one sidebar section's open accounts in their new order (a subset reorders only those). */
export const AccountOrderRequest = z
  .object({
    account_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, "account_ids must not repeat an id")
      .openapi({ description: "Account ids in their new order: one section, open accounts only." }),
  })
  .openapi("AccountOrderRequest");
export type AccountOrderRequest = z.input<typeof AccountOrderRequest>;
export const AccountListResponse = dataEnvelope(z.object({ accounts: z.array(Account) })).openapi(
  "AccountListResponse",
);
export const AccountCreateResponse = dataEnvelope(
  z.object({ account: Account, starting_balance: Transaction }),
).openapi("AccountCreateResponse");

export const AccountAdjustmentResponse = dataEnvelope(
  z.object({ account: Account, adjustment: Transaction.nullable() }),
).openapi("AccountAdjustmentResponse");

export const AccountDeleteResponse = dataEnvelope(
  z.object({ account_id: z.uuid(), deleted_transaction_ids: z.array(z.uuid()) }),
).openapi("AccountDeleteResponse");

export const AccountsFromBankResponse = dataEnvelope(
  z.object({ created: z.array(z.object({ account: Account, starting_balance: Transaction })) }),
).openapi("AccountsFromBankResponse");

export type AccountType = z.infer<typeof AccountType>;
export type AccountGroup = z.infer<typeof AccountGroup>;
export type Account = z.infer<typeof Account>;
export type ConnectionStatus = NonNullable<Account["connection_status"]>;
export type AccountCreate = z.infer<typeof AccountCreate>;
export type AccountCreateRequest = z.input<typeof AccountCreateRequest>;
export type AccountUpdateRequest = z.input<typeof AccountUpdateRequest>;
export type AccountsFromBankRequest = z.input<typeof AccountsFromBankRequest>;
export type AccountLinkRequest = z.input<typeof AccountLinkRequest>;
export type AccountAdjustBalanceRequest = z.input<typeof AccountAdjustBalanceRequest>;
export type AccountCloseRequest = z.input<typeof AccountCloseRequest>;
