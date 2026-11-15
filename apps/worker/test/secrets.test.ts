import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteSecret, getSecret, setSecret } from "../src/secrets";

const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("secrets", () => {
  it("stores ciphertext, never the plaintext, and round-trips", async () => {
    await setSecret(env, "plaid_x", "super-secret-value");
    const row = await env.DB.prepare(
      "SELECT ciphertext, iv, key_version FROM secrets WHERE name = 'plaid_x'",
    ).first<{
      ciphertext: number[];
      iv: number[];
      key_version: number;
    }>();
    const stored = new TextDecoder().decode(new Uint8Array(row?.ciphertext ?? []));
    expect(stored).not.toBe("super-secret-value");
    expect(stored).not.toContain("super-secret-value");
    expect(row?.iv.length).toBe(12);
    expect(row?.key_version).toBe(1);
    expect(await getSecret(env, "plaid_x")).toBe("super-secret-value");
    expect(await getSecret(env, "missing")).toBeNull();
  });
  it("fails with a wrong key", async () => {
    await setSecret(env, "plaid_k", "v");
    await expect(
      getSecret({ ...env, SECRETS_ENCRYPTION_KEY: otherKey }, "plaid_k"),
    ).rejects.toThrow();
  });
  it("fails when a record is tampered with", async () => {
    await setSecret(env, "plaid_t", "value");
    await env.DB.prepare(
      "UPDATE secrets SET ciphertext = x'00' || substr(ciphertext, 2) WHERE name = 'plaid_t'",
    ).run();
    const row = await env.DB.prepare(
      "SELECT hex(ciphertext) AS h FROM secrets WHERE name='plaid_t'",
    ).first<{ h: string }>();
    expect(row?.h.startsWith("00")).toBe(true);
    await env.DB.prepare(
      "UPDATE secrets SET ciphertext = x'ff' || substr(ciphertext, 2) WHERE name = 'plaid_t'",
    ).run();
    await expect(getSecret(env, "plaid_t")).rejects.toThrow();
  });
  it("binds a record to its name (AAD)", async () => {
    await setSecret(env, "plaid_a", "value");
    await env.DB.prepare(
      "INSERT INTO secrets SELECT 'plaid_b', ciphertext, iv, key_version, created_at, updated_at FROM secrets WHERE name='plaid_a'",
    ).run();
    await expect(getSecret(env, "plaid_b")).rejects.toThrow();
  });
  it("refuses without a key and deletes", async () => {
    await expect(
      setSecret({ ...env, SECRETS_ENCRYPTION_KEY: undefined }, "n", "v"),
    ).rejects.toThrow("not set");
    await setSecret(env, "plaid_d", "v");
    await deleteSecret(env, "plaid_d");
    expect(await getSecret(env, "plaid_d")).toBeNull();
  });
  it("is not exposed by the API", async () => {
    const { call, authed } = await import("./helpers");
    expect((await call("/api/v1/secrets", await authed())).status).toBe(404);
  });
});
