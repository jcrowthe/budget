import { z } from "@hono/zod-openapi";
import { BankEnvironment } from "./budgets";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { SYNC_STATUSES } from "./plaid-import";

export const BankAccount = z
  .object({
    id: z.uuid(),
    bank_connection_id: z.uuid(),
    name: z.string(),
    mask: z.string().nullable(),
    type: z.string(),
    subtype: z.string().nullable(),
    current_balance: Milliunits.nullable(),
    available_balance: Milliunits.nullable(),
    balance_updated_at: z.string().nullable(),
    linked_account_id: z.uuid().nullable().openapi({
      description:
        "The account of the plan named by budget_id that is linked to this bank account; null when none",
    }),
  })
  .openapi("BankAccount");

export const BankConnection = z
  .object({
    id: z.uuid(),
    display_id: z.string().regex(/^[0-9a-f]{6}$/),
    environment: BankEnvironment,
    institution_id: z.string(),
    institution_name: z.string(),
    institution_logo: z.string().nullable(),
    nickname: z.string(),
    status: z.string().openapi({
      description:
        "connected, delayed (the bank or Plaid did not answer, or the last sync failed in Budget, see sync_failed_at; it is retried), login_required (the bank needs a new sign-in), broken (the connection is lost) or not_set_up",
    }),
    provider: z.string().openapi({ description: "Plaid" }),
    last_synced_at: z.string().nullable(),
    last_reset_at: z.string().nullable(),
    sync_failed_at: z.string().nullable().default(null).openapi({
      description:
        "When the last sync that failed in Budget (not at the bank) ended; null once a sync finishes. Such a sync leaves status delayed and is retried.",
    }),
    created_at: z.string(),
    accounts: z.array(BankAccount),
  })
  .openapi("BankConnection");

export const LinkTokenCreate = z.object({ budget_id: z.uuid() }).openapi("LinkTokenCreate");
export const LinkTokenResponse = dataEnvelope(
  z.object({ link_token: z.string(), expiration: z.string() }),
).openapi("LinkTokenResponse");

export const BankConnectionCreate = z
  .object({
    budget_id: z.uuid(),
    public_token: z.string().min(1).max(500),
    institution_id: z.string().min(1).max(100),
    institution_name: z.string().min(1).max(200).optional(),
  })
  .openapi("BankConnectionCreate");
export const BankConnectionsQuery = z.object({ budget_id: z.uuid() });

export const BankConnectionParams = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" } }),
});
/** The query of every `/bank-connections/{id}` route: the plan decides the environment. */
export const BankConnectionScope = z.object({ budget_id: z.uuid() });
export const BankConnectionUpdate = z
  .object({ nickname: z.string().max(100) })
  .openapi("BankConnectionUpdate");
export const BankConnectionDeleted = dataEnvelope(
  z.object({ deleted: z.literal(true), plaid: z.enum(["removed", "already_removed"]) }),
).openapi("BankConnectionDeletedResponse");

export const SyncStatus = z.enum(SYNC_STATUSES);
export const SyncResult = z
  .object({
    bank_connection_id: z.string(),
    status: SyncStatus,
    added: z.number().int().min(0).describe("Transactions imported as new"),
    matched: z.number().int().min(0).describe("Imports matched to a transaction entered by hand"),
    modified: z.number().int().min(0).describe("Imported transactions changed to follow the bank"),
    removed: z.number().int().min(0).describe("Unapproved imports the bank withdrew, deleted"),
    skipped: z.number().int().min(0).describe("Entries not imported by the import rules"),
    has_more: z
      .boolean()
      .describe(
        "True when there is more to read (the bank has more, or the run stopped at its limit): sync again",
      ),
    last_synced_at: z.string().nullable(),
  })
  .openapi("SyncResult");
export const SyncResultResponse = dataEnvelope(SyncResult);
export const PlanSyncResponse = dataEnvelope(z.object({ results: z.array(SyncResult) }));
export const BankConnectionResponse = dataEnvelope(
  z.object({ bank_connection: BankConnection }),
).openapi("BankConnectionResponse");
export const BankConnectionListResponse = dataEnvelope(
  z.object({ bank_connections: z.array(BankConnection) }),
).openapi("BankConnectionListResponse");

export type SyncResult = z.infer<typeof SyncResult>;
export type BankAccount = z.infer<typeof BankAccount>;
export type BankConnection = z.infer<typeof BankConnection>;
export type BankConnectionCreate = z.infer<typeof BankConnectionCreate>;
export type BankConnectionUpdate = z.infer<typeof BankConnectionUpdate>;
