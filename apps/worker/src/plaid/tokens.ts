import type { Db } from "../db/client";
import type { Env } from "../env";
import { deleteSecret, deleteSecretStmt, getSecret, setSecret } from "../secrets";

/** Access tokens live in `secrets`, keyed by the bank connection id. Never in a response, log or row. */
export const accessTokenSecretName = (connectionId: string) => `plaid_access_token:${connectionId}`;

export const getAccessToken = (env: Env, connectionId: string) =>
  getSecret(env, accessTokenSecretName(connectionId));
export const storeAccessToken = (env: Env, connectionId: string, token: string) =>
  setSecret(env, accessTokenSecretName(connectionId), token);
export const deleteAccessToken = (env: Env, connectionId: string) =>
  deleteSecret(env, accessTokenSecretName(connectionId));
export const deleteAccessTokenStmt = (db: Db, connectionId: string) =>
  deleteSecretStmt(db, accessTokenSecretName(connectionId));
