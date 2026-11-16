import { eq } from "drizzle-orm";
import { type Db, getDb } from "../db/client";
import { secrets } from "../db/schema/secrets";
import type { Env } from "../env";
import { deriveKey, KeyTooShort, open, seal } from "./crypto";

/** The only code that touches the `secrets` table. Values never leave through routes, tools or logs. */
export const CURRENT_KEY_VERSION = 1;

export class SecretsUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsUnavailable";
  }
}

async function keyFor(env: Env, version: number): Promise<CryptoKey> {
  // Rotation: a later version N derives with keyInfo(N) from its own Worker secret; re-seal lazily.
  if (version === 1) {
    if (!env.SECRETS_ENCRYPTION_KEY)
      throw new SecretsUnavailable("SECRETS_ENCRYPTION_KEY is not set");
    try {
      return await deriveKey(env.SECRETS_ENCRYPTION_KEY, 1);
    } catch (e) {
      if (e instanceof KeyTooShort) throw new SecretsUnavailable(e.message);
      throw e;
    }
  }
  throw new SecretsUnavailable(`No key for version ${version}`);
}

export async function setSecret(env: Env, name: string, value: string): Promise<void> {
  const key = await keyFor(env, CURRENT_KEY_VERSION);
  const { ciphertext, iv } = await seal(key, name, value);
  const now = new Date().toISOString();
  await getDb(env)
    .insert(secrets)
    .values({
      name,
      ciphertext: ciphertext as unknown as Buffer,
      iv: iv as unknown as Buffer,
      keyVersion: CURRENT_KEY_VERSION,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: secrets.name,
      set: {
        ciphertext: ciphertext as unknown as Buffer,
        iv: iv as unknown as Buffer,
        keyVersion: CURRENT_KEY_VERSION,
        updatedAt: now,
      },
    });
}

export async function getSecret(env: Env, name: string): Promise<string | null> {
  const [row] = await getDb(env).select().from(secrets).where(eq(secrets.name, name)).limit(1);
  if (!row) return null;
  const key = await keyFor(env, row.keyVersion);
  return open(key, name, new Uint8Array(row.ciphertext), new Uint8Array(row.iv));
}

export async function deleteSecret(env: Env, name: string): Promise<void> {
  await getDb(env).delete(secrets).where(eq(secrets.name, name));
}

/** An unexecuted delete, for a `db.batch`; `deleteSecret` executes alone. */
export function deleteSecretStmt(db: Db, name: string) {
  return db.delete(secrets).where(eq(secrets.name, name));
}
