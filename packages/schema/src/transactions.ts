import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { PayeeSystem } from "./payees";

// Repeats core's CLEARED_STATUSES; a Worker test asserts they are equal.
/** True only for a real calendar date: "2026-02-30" and "2026-13-05" round-trip to a different string. */
export function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const ClearedStatus = z
  .enum(["uncleared", "cleared", "reconciled"])
  .openapi("ClearedStatus");

export const FLAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export const FlagColor = z.enum(FLAG_COLORS).openapi("FlagColor");
export type FlagColor = z.infer<typeof FlagColor>;
export const FLAG_NAMES: Record<FlagColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

export const Transaction = z
  .object({
    id: z.uuid(),
    budget_id: z.uuid(),
    account_id: z.uuid(),
    date: IsoDate,
    payee_id: z.string().nullable(),
    payee_name: z.string().nullable(),
    category_id: z.uuid().nullable(),
    inflow_to_ready_to_assign: z.boolean(),
    memo: z.string().nullable(),
    amount: Milliunits,
    cleared: ClearedStatus,
    approved: z.boolean(),
    created_at: z.string(),
    import_id: z.string().nullable().openapi({
      description:
        "The bank's id of the transaction when it came from (or was matched to) an import",
    }),
    source: z.enum(["plaid"]).nullable().openapi({
      description: "plaid for a transaction the bank import created; null when entered by hand",
    }),
    imported_payee: z.string().nullable().openapi({
      description: "The payee name the bank sent, as sent",
    }),
    bank_description: z.string().nullable().openapi({
      description: "The bank's own description of the transaction",
    }),
    matched: z.boolean().openapi({
      description: "True when an imported transaction was matched to one entered by hand",
    }),
    flag_color: FlagColor.nullable().openapi({
      description:
        "The row's flag: red, orange, yellow, green, blue or purple; null when not flagged",
    }),
  })
  .openapi("Transaction");

export const TransactionCreate = z
  .object({
    budget_id: z.uuid(),
    account_id: z.uuid(),
    date: IsoDate.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199"),
    amount: Milliunits,
    category_id: z.uuid().nullable().optional(),
    inflow_to_ready_to_assign: z.boolean().default(false),
    payee_name: z.string().max(200).nullable().optional(),
    memo: z.string().max(500).nullable().optional(),
    cleared: ClearedStatus.default("uncleared"),
    approved: z.boolean().default(true),
  })
  .refine((v) => isCalendarDate(v.date), { message: "date must be a real calendar date" })
  .refine((v) => !(v.category_id && v.inflow_to_ready_to_assign), {
    message: "A transaction cannot have both a category and the Ready to Assign inflow flag",
  })
  .openapi("TransactionCreate");

export type ClearedStatus = z.infer<typeof ClearedStatus>;
export type Transaction = z.infer<typeof Transaction>;
export type TransactionCreate = z.input<typeof TransactionCreate>;
export type TransactionCreateParsed = z.output<typeof TransactionCreate>;

/** What a request may set: reconciling is not available through the transactions routes (EXF-533). */
export const PlainClearedStatus = z.enum(["uncleared", "cleared"]);

/** One line of a split transaction. */
export const SubTransaction = z
  .object({
    id: z.string(),
    amount: Milliunits,
    payee_id: z.string().nullable(),
    payee_name: z.string().nullable(),
    category_id: z.string().nullable(),
    category_name: z.string().nullable(),
    category_group_name: z.string().nullable(),
    inflow_to_ready_to_assign: z.boolean(),
    memo: z.string().nullable(),
  })
  .openapi("SubTransaction");
export type SubTransaction = z.infer<typeof SubTransaction>;

/** What the bank sent for a matched transaction, as imported. */
export const MatchDetails = z
  .object({ date: IsoDate, amount: Milliunits, payee_name: z.string().nullable() })
  .describe("What the bank sent for a matched transaction")
  .openapi("MatchDetails");

export const TransactionDetail = Transaction.extend({
  category_name: z.string().nullable(),
  category_group_name: z.string().nullable(),
  payee_system: PayeeSystem.nullable(),
  transfer_account_id: z.string().nullable(),
  transfer_transaction_id: z.string().nullable(),
  transfer_account_name: z.string().nullable(),
  subtransactions: z.array(SubTransaction),
  updated_at: z.string(),
  match_details: MatchDetails.nullable()
    .default(null)
    .describe(
      "The bank's date, amount and payee as imported, for a matched transaction; else null",
    ),
}).openapi("TransactionDetail");

export const AccountBalances = z
  .object({ cleared: Milliunits, uncleared: Milliunits, working: Milliunits })
  .openapi("AccountBalances");

/** A row of the plan-wide list: the detail plus the name of its account. */
export const PlanTransaction = TransactionDetail.extend({ account_name: z.string() }).openapi(
  "PlanTransaction",
);

const requestDate = IsoDate.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199").refine(
  isCalendarDate,
  { message: "date must be a real calendar date" },
);

const requestFields = {
  account_id: z.string().min(1),
  date: requestDate,
  amount: Milliunits,
  payee_id: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "An existing payee of the plan (from list_payees). Give payee_id or payee_name, not both.",
    ),
  payee_name: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .describe(
      "Payee text; an exact (case-sensitive) match to a non-system payee of the plan, hidden ones included, is used, otherwise a new payee is created with the transaction. Null or empty clears the payee.",
    ),
  category_id: z.string().min(1).nullable().optional(),
  inflow_to_ready_to_assign: z.boolean().optional(),
  memo: z.string().max(500).nullable().optional(),
  // Checked in the service, so "reconciled" gets its own 422 detail.
  cleared: ClearedStatus.optional(),
  approved: z.boolean().optional(),
  transfer_account_id: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "The other account of a transfer: the server creates or keeps its paired row (opposite amount, same date and memo). Null on update makes the transaction a plain one again.",
    ),
  subtransactions: z
    .array(
      z
        .object({
          amount: Milliunits,
          payee_id: z.string().min(1).nullable().optional(),
          payee_name: z.string().max(200).nullable().optional(),
          category_id: z.string().min(1).nullable().optional(),
          inflow_to_ready_to_assign: z.boolean().optional(),
          memo: z.string().max(500).nullable().optional(),
        })
        .strict(),
    )
    .max(50)
    .optional()
    .describe(
      "Split lines (at least two) whose signed amounts add up to amount; on update an empty list turns a split back into a plain transaction.",
    ),
};

export const TransactionCreateRequest = z
  .object(requestFields)
  .strict()
  .openapi("TransactionCreateRequest");

const updateFields = z
  .object({
    account_id: requestFields.account_id.optional(),
    date: requestFields.date.optional(),
    amount: requestFields.amount.optional(),
    payee_id: requestFields.payee_id,
    payee_name: requestFields.payee_name,
    category_id: requestFields.category_id,
    inflow_to_ready_to_assign: requestFields.inflow_to_ready_to_assign,
    memo: requestFields.memo,
    cleared: requestFields.cleared,
    approved: requestFields.approved,
    transfer_account_id: requestFields.transfer_account_id,
    subtransactions: requestFields.subtransactions,
    flag_color: FlagColor.nullable().optional(),
    confirm_reconciled: z
      .boolean()
      .optional()
      .describe(
        "Must be true to change the amount, date, account, cleared state or transfer account of a reconciled transaction (or of a transfer whose other side is reconciled)",
      ),
  })
  .strict();

/** The PATCH fields without the "at least one" rule, for the MCP tool's input shape. */
export const transactionUpdateShape = updateFields.shape;

export const TransactionUpdateRequest = updateFields
  .refine(
    (o) => Object.keys(o).filter((k) => k !== "confirm_reconciled").length > 0,
    "Nothing to update",
  )
  .openapi("TransactionUpdateRequest");

/** `needs` filter of the transaction lists. */
export const TRANSACTION_NEEDS = ["approval_or_category"] as const;

export const TransactionIds = z
  .array(z.string().min(1))
  .min(1)
  .max(100)
  .describe("Transaction ids (1 to 100); a repeated id counts once");

export const TransactionIdsRequest = z
  .object({ ids: TransactionIds })
  .strict()
  .openapi("TransactionIdsRequest");

export const BULK_OPS = [
  "clear",
  "unclear",
  "categorize",
  "memo",
  "move",
  "duplicate",
  "delete",
  "flag",
] as const;

export const BulkSkipReason = z
  .enum([
    "reconciled",
    "unchanged",
    "split",
    "tracking_account",
    "category_not_needed",
    "starting_balance",
  ])
  .openapi("BulkSkipReason");

export const TransactionBulkRequest = z
  .discriminatedUnion("op", [
    z.object({ op: z.literal("clear"), ids: TransactionIds }).strict(),
    z.object({ op: z.literal("unclear"), ids: TransactionIds }).strict(),
    z.object({ op: z.literal("duplicate"), ids: TransactionIds }).strict(),
    z
      .object({
        op: z.literal("delete"),
        ids: TransactionIds,
        confirm_reconciled: z
          .boolean()
          .optional()
          .describe("Must be true to delete a reconciled row, or a row whose other side is"),
      })
      .strict(),
    z
      .object({
        op: z.literal("categorize"),
        ids: TransactionIds,
        value: z
          .string()
          .min(1)
          .describe('A category id, or "ready_to_assign" for Inflow: Ready to Assign'),
      })
      .strict(),
    z
      .object({
        op: z.literal("memo"),
        ids: TransactionIds,
        value: z.string().max(500).nullable().describe("The new memo; null or empty clears it"),
      })
      .strict(),
    z
      .object({
        op: z.literal("move"),
        ids: TransactionIds,
        value: z.string().min(1).describe("The id of the account to move the rows to"),
      })
      .strict(),
    z
      .object({
        op: z.literal("flag"),
        ids: TransactionIds,
        value: FlagColor.nullable().describe("The flag colour, or null to clear the flag"),
      })
      .strict(),
  ])
  .openapi("TransactionBulkRequest");
export type TransactionBulkRequest = z.input<typeof TransactionBulkRequest>;

export const TransactionBulkResult = z
  .object({
    op: z.enum(BULK_OPS),
    changed: z.array(z.string()).describe("The requested ids that changed, in the order given"),
    skipped: z
      .array(z.object({ id: z.string(), reason: BulkSkipReason }))
      .describe("The requested ids left alone, with the reason"),
    others: z
      .array(z.string())
      .describe("Other sides of transfers that changed with the requested rows"),
    copies: z
      .array(z.object({ id: z.string(), copy_id: z.string() }))
      .describe("For duplicate: each source id and its copy"),
    transactions: z
      .array(TransactionDetail)
      .describe("The rows after the change (the copies for duplicate, as they were for delete)"),
  })
  .openapi("TransactionBulkResult");
export type TransactionBulkResult = z.infer<typeof TransactionBulkResult>;
export const TransactionBulkResponse = dataEnvelope(TransactionBulkResult);

export const TransactionMatchRequest = z
  .object({
    ids: z
      .array(z.string().min(1))
      .length(2, "Select exactly two different transactions to match")
      .refine((a) => a[0] !== a[1], "Select exactly two different transactions to match")
      .describe("The two transactions to match: one unapproved import and one hand entry"),
  })
  .strict()
  .openapi("TransactionMatchRequest");
export const MatchResult = z
  .object({
    transaction: TransactionDetail.describe("The surviving transaction (the hand entry's row)"),
    removed: TransactionDetail.describe("The import's row as it was, now deleted"),
  })
  .openapi("MatchResult");
export const UnmatchResult = z
  .object({
    transaction: TransactionDetail.describe("The hand entry, with its own amount again"),
    imported: TransactionDetail.describe("The import, as a new unapproved transaction"),
  })
  .openapi("UnmatchResult");
export const MatchResponse = dataEnvelope(MatchResult);
export const UnmatchResponse = dataEnvelope(UnmatchResult);
export type MatchResult = z.infer<typeof MatchResult>;
export type UnmatchResult = z.infer<typeof UnmatchResult>;

export const TransactionResponse = dataEnvelope(z.object({ transaction: TransactionDetail }));
/** A row of an account's list; `running_balance` only with `include=running_balance`. */
export const RegisterTransaction = TransactionDetail.extend({
  running_balance: Milliunits.optional(),
}).openapi("RegisterTransaction");
export const TransactionListResponse = dataEnvelope(
  z.object({ transactions: z.array(RegisterTransaction), balances: AccountBalances }),
);

export const TransactionsResponse = dataEnvelope(
  z.object({ transactions: z.array(TransactionDetail) }),
);

export const PlanTransactionListResponse = dataEnvelope(
  z.object({ transactions: z.array(PlanTransaction), balances: AccountBalances }),
);

export type TransactionIdsRequest = z.input<typeof TransactionIdsRequest>;
export type PlanTransaction = z.infer<typeof PlanTransaction>;
export type TransactionDetail = z.infer<typeof TransactionDetail>;
export type AccountBalances = z.infer<typeof AccountBalances>;
export type TransactionCreateRequest = z.input<typeof TransactionCreateRequest>;
export type TransactionUpdateRequest = z.input<typeof TransactionUpdateRequest>;

export type SubTransactionInput = NonNullable<TransactionCreateRequest["subtransactions"]>[number];
