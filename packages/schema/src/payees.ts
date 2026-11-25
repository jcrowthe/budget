import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { CategoryMode } from "./payee-category";

export const PAYEE_SYSTEMS = [
  "starting_balance",
  "manual_adjustment",
  "reconciliation_adjustment",
] as const;
export const PayeeSystem = z.enum(PAYEE_SYSTEMS);
export type PayeeSystem = z.infer<typeof PayeeSystem>;

export const Payee = z
  .object({
    id: z.string(),
    name: z.string(),
    hidden: z.boolean(),
    system: PayeeSystem.nullable(),
    /** The category of the payee's latest transaction: that transaction, not the suggestion (see `default_category_id`). */
    last_category_id: z.string().nullable(),
    /** True when the payee's latest transaction is an inflow to Ready to Assign (then `last_category_id` is null); always false for system payees and transfer entries. */
    last_inflow_to_ready_to_assign: z.boolean(),
    /** How the category is suggested: from the payee's history, a fixed choice, or not at all. Transfer entries and system payees: `history`. */
    category_mode: CategoryMode,
    /** The fixed category, kept when the mode leaves `fixed`; null when none or when it is Ready to Assign. */
    fixed_category_id: z.string().nullable(),
    /** The fixed choice is Ready to Assign (then `fixed_category_id` is null). */
    fixed_inflow_to_ready_to_assign: z.boolean(),
    /** The suggested category now: null for `off`, the fixed choice while live for `fixed`, the history default for `history`; null for transfer entries and system payees. */
    default_category_id: z
      .string()
      .nullable()
      .openapi({ readOnly: true, description: "The suggested category now, from the mode" }),
    /** The suggestion is Ready to Assign (then `default_category_id` is null). */
    default_inflow_to_ready_to_assign: z
      .boolean()
      .openapi({ readOnly: true, description: "The suggestion is Ready to Assign" }),
    /** Set on the "Transfer : <account>" entries, which stand for an open account of the plan. */
    transfer_account_id: z.string().nullable(),
    /** Live transactions (parents and split lines, in open or closed accounts) that name this payee; 0 for transfer entries. */
    transaction_count: z.number().int().min(0),
    /** Live scheduled transactions that name this payee; 0 for transfer entries. */
    scheduled_count: z.number().int().min(0),
    /** True when the payee has renaming rules; always false for transfer entries. */
    has_rules: z.boolean().openapi({ description: "True when the payee has renaming rules" }),
  })
  .openapi("Payee");
export type Payee = z.infer<typeof Payee>;

export const PayeeListResponse = dataEnvelope(z.object({ payees: z.array(Payee) }));

export const PayeeListQuery = z.object({
  q: z.string().max(200).optional(),
  include_hidden: z.enum(["true", "false"]).optional(),
});

export const PayeeIdParam = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  payee_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "payee_id", in: "path" } }),
});

export const PayeeUpdate = z
  .object({
    name: z.string().max(200).optional(),
    hidden: z.boolean().optional(),
    category_mode: CategoryMode.optional(),
    /** A category or Ready to Assign, never both. `fixed` needs one, given now or already stored. */
    fixed_category_id: z.string().min(1).nullable().optional(),
    fixed_inflow_to_ready_to_assign: z.boolean().optional(),
  })
  .openapi("PayeeUpdate");
export type PayeeUpdate = z.infer<typeof PayeeUpdate>;

export const PayeeRecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

/** One of a payee's last counted transactions (see docs/payee-category-design.md). */
export const PayeeRecentTransaction = z
  .object({
    id: z.string(),
    account_id: z.string(),
    date: IsoDate,
    category_id: z.string().nullable(),
    category_name: z.string().nullable(),
    category_group_name: z.string().nullable(),
    inflow_to_ready_to_assign: z.boolean(),
    amount: Milliunits,
  })
  .openapi("PayeeRecentTransaction");
export type PayeeRecentTransaction = z.infer<typeof PayeeRecentTransaction>;
export const PayeeRecentResponse = dataEnvelope(
  z.object({ transactions: z.array(PayeeRecentTransaction) }),
);

export const PayeeResponse = dataEnvelope(z.object({ payee: Payee }));

export const PayeeDeleteQuery = z.object({ replacement_payee_id: z.string().min(1).optional() });

export const PayeeDeleted = z
  .object({
    id: z.string(),
    name: z.string(),
    replacement_payee_id: z.string().nullable(),
    transactions_moved: z.number().int(),
    scheduled_moved: z.number().int(),
  })
  .openapi("PayeeDeleted");
export type PayeeDeleted = z.infer<typeof PayeeDeleted>;
export const PayeeDeleteResponse = dataEnvelope(z.object({ deleted: PayeeDeleted }));

export const PAYEE_BULK_MAX = 1000;
export const PayeeBulkRequest = z
  .object({
    payee_ids: z.array(z.string().min(1)).min(1).max(PAYEE_BULK_MAX),
    action: z.enum(["hide", "unhide", "delete"]),
    replacement_payee_id: z.string().min(1).nullable().optional(),
  })
  .openapi("PayeeBulkRequest");
export type PayeeBulkRequest = z.infer<typeof PayeeBulkRequest>;
export const PayeeBulkResponse = dataEnvelope(
  z.object({ payees: z.array(Payee), deleted: z.array(PayeeDeleted) }),
);

/** Combine and Rename (EXF-512): several payees become one. */
export const PayeeCombineRequest = z
  .object({
    payee_ids: z.array(z.string().min(1)).min(2).max(PAYEE_BULK_MAX),
    name: z.string().max(200),
    target_payee_id: z.string().min(1).optional(),
  })
  .openapi("PayeeCombineRequest");
export type PayeeCombineRequest = z.infer<typeof PayeeCombineRequest>;
export const PayeeCombineResponse = dataEnvelope(
  z.object({
    payee: Payee,
    merged: z.array(PayeeDeleted),
    rules_moved: z.number().int(),
    rules_dropped: z.number().int(),
  }),
);

/** The words of the Combine and Rename card, shared with the web. */
export const COMBINE = {
  title: "Combine and Rename",
  note: "Combining these payees will also combine all their renaming rules and categorization rules.",
  placeholder: "New Payee Name",
  button: "Combine",
} as const;

export const PAYEE_TRANSACTIONS_LIMIT = 500;
export const PayeeTransaction = z
  .object({
    id: z.string(),
    kind: z.enum(["transaction", "scheduled"]),
    account_id: z.string(),
    account_name: z.string(),
    date: IsoDate,
    category_id: z.string().nullable(),
    category_name: z.string().nullable(),
    inflow_to_ready_to_assign: z.boolean(),
    is_split: z.boolean(),
    memo: z.string().nullable(),
    amount: Milliunits,
  })
  .openapi("PayeeTransaction");
export type PayeeTransaction = z.infer<typeof PayeeTransaction>;
export const PayeeTransactionsResponse = dataEnvelope(
  z.object({ transactions: z.array(PayeeTransaction), total_count: z.number().int() }),
);

/** The words of the refusals, shared with the web. */
export const PAYEE_ERRORS = {
  duplicate: "Another payee already exists with this name",
  empty: "Payee name cannot be empty",
  transfer: "Transfer payees can't be edited or deleted",
  system: "System payees are set by the app and can't be edited or deleted",
  noField: "Give name, hidden, category_mode or a fixed choice",
  fixedNeedsValue: "A fixed mode needs a fixed category or Ready to Assign",
  categoryUnknown: "Category not found in this plan",
  fixedBoth: "A fixed choice is a category or Ready to Assign, not both",
  replacement: "The replacement must be an ordinary payee of this plan",
  replaceSelf: "A payee can't replace itself",
  replacementOnlyDelete: "replacement_payee_id goes only with delete",
  unknown: "Payee not found in this plan",
  race: "The payees changed meanwhile. Try again.",
  combineTooFew: "Select at least two payees to combine",
  combineTarget: "target_payee_id must be one of payee_ids",
  combineTransfer: "Transfer payees can't be combined",
  combineSystem: "System payees can't be combined",
  combineNameInSelection: "That name belongs to another selected payee; make it the target",
} as const;

/** Case-insensitive, then exact, then id: a stable order for lists. */
export function compareNames(
  a: { id: string; name: string },
  b: { id: string; name: string },
): number {
  const la = a.name.toLowerCase();
  const lb = b.name.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type PayeeMenu = {
  top: null | { kind: "create"; text: string } | { kind: "hidden"; payees: Payee[]; label: string };
  help: string | null;
  transfersHeading: "Payments and Transfers";
  /** The transfer entries ("Transfer : <account>"), all but the current account's. */
  transfers: Payee[];
  heading: "Saved Payees";
  saved: Payee[];
  hint: string | null;
  /** Index into [top?, ...transfers, ...saved]; -1 when nothing is highlighted. */
  active: number;
};

const TRANSFER_NAME_PREFIX = "Transfer : ";

/** What the payee picker lists for the typed text. Pure. */
export function payeeMenu(
  payees: Payee[],
  text: string,
  opts: {
    currentAccountId?: string | null;
    transfers?: boolean;
    /** The label an entry shows; the typed text matches it too (default: "To/From <account>"). */
    transferLabel?: (p: Payee) => string;
  } = {},
): PayeeMenu {
  const t = text.trim();
  const ordinary = payees.filter((p) => !p.transfer_account_id);
  const visible = ordinary.filter((p) => !p.hidden && p.system === null).sort(compareNames);
  const needle = t.toLowerCase();
  const transfers =
    opts.transfers === false
      ? []
      : payees
          .filter((p) => p.transfer_account_id && p.transfer_account_id !== opts.currentAccountId)
          .filter((p) => {
            if (needle === "") return true;
            const name = p.name.startsWith(TRANSFER_NAME_PREFIX)
              ? p.name.slice(TRANSFER_NAME_PREFIX.length)
              : p.name;
            return (
              p.name.toLowerCase().includes(needle) ||
              `to/from ${name}`.toLowerCase().includes(needle) ||
              (opts.transferLabel?.(p) ?? "").toLowerCase().includes(needle)
            );
          })
          .sort(compareNames);
  if (t === "") {
    return {
      top: null,
      help: null,
      transfersHeading: "Payments and Transfers",
      transfers,
      heading: "Saved Payees",
      saved: visible,
      hint: visible.length === 0 ? "Start typing to add a payee." : null,
      active: -1,
    };
  }
  const saved = visible.filter((p) => p.name.toLowerCase().includes(needle));
  const hiddenExact = ordinary.filter((p) => p.hidden && p.system === null && p.name === t);
  const top: PayeeMenu["top"] =
    hiddenExact.length > 0
      ? {
          kind: "hidden",
          payees: hiddenExact,
          label:
            hiddenExact.length === 1
              ? "1 matching payee is hidden"
              : `${hiddenExact.length} matching payees are hidden`,
        }
      : { kind: "create", text: t };
  // [top, ...transfers, ...saved]: the first saved match, else the first transfer, else the top item.
  const active = saved.length > 0 ? 1 + transfers.length : transfers.length > 0 ? 1 : 0;
  return {
    top,
    help:
      top.kind === "create" && saved.length === 0 && transfers.length === 0
        ? `"${t}" will be created as a payee.`
        : null,
    transfersHeading: "Payments and Transfers",
    transfers,
    heading: "Saved Payees",
    saved,
    hint: null,
    active,
  };
}

// ---- Manage Payees dialog: the pure model ----

export const HIDDEN_NOTE =
  "Hidden payees will not be suggested as you type or included in the list of payees when adding a transaction. This is useful for payees you don't expect to use again, like from a trip or event.";
export const TRANSFER_NOTE =
  "Transfer payees are used to move money between accounts, including credit card payments. Budget creates these for you, so they can't be edited or deleted.";
export const EMPTY_PICK = "Select a payee to edit.";
export const NO_PAYEES =
  "You don’t have any payees yet! Come back once you have some transactions.";

/** Every whitespace-separated word of `text` is a case-insensitive substring of `name`. */
export function nameMatches(name: string, text: string): boolean {
  const hay = name.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "")
    .every((w) => hay.includes(w));
}

export type ManageGroups = { payees: Payee[]; transfers: Payee[]; hidden: Payee[] };

/** The dialog's three groups for the typed search: system payees are left out, each group sorted by name. */
export function manageGroups(all: Payee[], text: string): ManageGroups {
  const g: ManageGroups = { payees: [], transfers: [], hidden: [] };
  for (const p of all) {
    if (p.system !== null) continue;
    if (!nameMatches(p.name, text)) continue;
    if (p.transfer_account_id) g.transfers.push(p);
    else if (p.hidden) g.hidden.push(p);
    else g.payees.push(p);
  }
  g.payees.sort(compareNames);
  g.transfers.sort(compareNames);
  g.hidden.sort(compareNames);
  return g;
}

export const usedCount = (p: Pick<Payee, "transaction_count" | "scheduled_count">): number =>
  p.transaction_count + p.scheduled_count;

/** The ids of the shown, not hidden, ordinary payees without a transaction. */
export function unusedIds(groups: ManageGroups): string[] {
  return groups.payees.filter((p) => usedCount(p) === 0).map((p) => p.id);
}

export const showTransactionsLabel = (n: number) =>
  n === 1 ? "Show 1 Transaction" : `Show ${n} Transactions`;
export const unusedLabel = (n: number) =>
  n === 1 ? "Select 1 Unused Payee" : `Select ${n} Unused Payees`;
export const selectedLabel = (n: number) => (n === 1 ? "1 Payee Selected" : `${n} Payees Selected`);
export const usingSentence = (n: number) =>
  n === 1
    ? "1 transaction is using this payee(s). Select a new payee for this transaction."
    : `${n} transactions are using this payee(s). Select a new payee for these transactions.`;

export function paneMode(selected: Payee[]): "none" | "single" | "transfer" | "several" | "mixed" {
  if (selected.length === 0) return "none";
  const transfers = selected.filter((p) => p.transfer_account_id).length;
  if (selected.length === 1) return transfers === 1 ? "transfer" : "single";
  return transfers > 0 ? "mixed" : "several";
}
