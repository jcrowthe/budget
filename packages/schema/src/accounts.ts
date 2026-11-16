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

export const AccountCreateRequest = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    type: AccountType,
    balance: Milliunits,
    date: IsoDate.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199")
      .refine(isCalendarDate, "date must be a real calendar date")
      .optional(),
  })
  .openapi("AccountCreateRequest");

const accountUpdateFields = z.object({ starred: z.boolean().optional() }).strict();

/** The PATCH fields without the "at least one" rule, for the MCP tool's input shape. */
export const accountUpdateShape = accountUpdateFields.shape;

export const AccountUpdateRequest = accountUpdateFields
  .refine((o) => Object.keys(o).length > 0, "Nothing to update")
  .openapi("AccountUpdateRequest");

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

export type AccountType = z.infer<typeof AccountType>;
export type AccountGroup = z.infer<typeof AccountGroup>;
export type Account = z.infer<typeof Account>;
export type AccountCreate = z.infer<typeof AccountCreate>;
export type AccountCreateRequest = z.input<typeof AccountCreateRequest>;
export type AccountUpdateRequest = z.input<typeof AccountUpdateRequest>;
