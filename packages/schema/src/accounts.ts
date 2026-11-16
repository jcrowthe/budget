import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
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

export const AccountCreateRequest = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    type: AccountType,
    balance: Milliunits,
    date: PlanDate.optional(),
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
export type AccountCreate = z.infer<typeof AccountCreate>;
export type AccountCreateRequest = z.input<typeof AccountCreateRequest>;
export type AccountUpdateRequest = z.input<typeof AccountUpdateRequest>;
export type AccountsFromBankRequest = z.input<typeof AccountsFromBankRequest>;
export type AccountLinkRequest = z.input<typeof AccountLinkRequest>;
export type AccountAdjustBalanceRequest = z.input<typeof AccountAdjustBalanceRequest>;
export type AccountCloseRequest = z.input<typeof AccountCloseRequest>;
