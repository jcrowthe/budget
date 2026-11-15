export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  PLAID_ITEM_SYNC: DurableObjectNamespace;
  ENVIRONMENT: string;
  PUBLIC_HOSTNAME: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** JSON {sha256hex(client_id): name}, written by deploy. */
  ACCESS_SERVICE_TOKENS: string;
  DEPLOY_SHA: string;
  /** Only set in local dev and tests. */
  LOCAL_JWT_SECRET?: string;
  SECRETS_ENCRYPTION_KEY?: string;
}

export interface Identity {
  kind: "user" | "service";
  actor: string;
  email?: string;
}

export type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
