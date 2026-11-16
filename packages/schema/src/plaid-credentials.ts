import { z } from "@hono/zod-openapi";
import { BankEnvironment } from "./budgets";
import { dataEnvelope } from "./common/envelope";

export const PlaidCredentialsPut = z
  .object({
    environment: BankEnvironment,
    client_id: z.string().trim().min(1).max(100),
    secret: z.string().trim().min(1).max(200),
  })
  .openapi("PlaidCredentialsPut", { description: "Write-only: values are never returned." });

export const PlaidCredentialStatus = z
  .object({
    environment: BankEnvironment,
    configured: z.boolean(),
    set_at: z.string().nullable(),
  })
  .openapi("PlaidCredentialStatus");

export const PlaidCredentialPutResponse = dataEnvelope(PlaidCredentialStatus).openapi(
  "PlaidCredentialPutResponse",
);
export const PlaidCredentialsResponse = dataEnvelope(
  z.object({ credentials: z.array(PlaidCredentialStatus) }),
).openapi("PlaidCredentialsResponse");

export type PlaidCredentialsPut = z.infer<typeof PlaidCredentialsPut>;
export type PlaidCredentialStatus = z.infer<typeof PlaidCredentialStatus>;
