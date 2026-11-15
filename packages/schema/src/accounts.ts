import { z } from "@hono/zod-openapi";

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
    sort: z.number().int(),
    created_at: z.string(),
  })
  .openapi("Account");

export const AccountCreate = z
  .object({
    budget_id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    type: AccountType,
    on_budget: z.boolean(),
    note: z.string().max(500).nullable().optional(),
  })
  .openapi("AccountCreate");

export type AccountType = z.infer<typeof AccountType>;
export type Account = z.infer<typeof Account>;
export type AccountCreate = z.infer<typeof AccountCreate>;
