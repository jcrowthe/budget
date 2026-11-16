import { z } from "@hono/zod-openapi";
import { BankEnvironment } from "./budgets";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";

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
    status: z.string().openapi({ description: "connected" }),
    provider: z.string().openapi({ description: "Plaid" }),
    last_synced_at: z.string().nullable(),
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

export const BankConnectionResponse = dataEnvelope(
  z.object({ bank_connection: BankConnection }),
).openapi("BankConnectionResponse");
export const BankConnectionListResponse = dataEnvelope(
  z.object({ bank_connections: z.array(BankConnection) }),
).openapi("BankConnectionListResponse");

export type BankAccount = z.infer<typeof BankAccount>;
export type BankConnection = z.infer<typeof BankConnection>;
export type BankConnectionCreate = z.infer<typeof BankConnectionCreate>;
