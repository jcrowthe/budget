import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteSecret, getSecret, setSecret } from "../src/secrets";
import { deriveKey, open, seal } from "../src/secrets/crypto";

const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function randomKey(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

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

describe("key derivation", () => {
  it("round-trips with a 32-character key that is not base64 of 32 bytes", async () => {
    const k = randomKey(32);
    expect(atob(k).length).not.toBe(32);
    const e = { ...env, SECRETS_ENCRYPTION_KEY: k };
    await setSecret(e, "kd_32", "v32");
    expect(await getSecret(e, "kd_32")).toBe("v32");
  });
  it("round-trips with a 44-character base64 key", async () => {
    const k = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    expect(k.length).toBe(44);
    const e = { ...env, SECRETS_ENCRYPTION_KEY: k };
    await setSecret(e, "kd_44", "v44");
    expect(await getSecret(e, "kd_44")).toBe("v44");
    expect(await getSecret({ ...env, SECRETS_ENCRYPTION_KEY: ` ${k}\n` }, "kd_44")).toBe("v44");
  });
  it("refuses a key shorter than 32 characters without revealing it", async () => {
    const k = randomKey(31);
    await setSecret(env, "kd_short", "v");
    for (const value of [k, `  ${k}  `]) {
      const e = { ...env, SECRETS_ENCRYPTION_KEY: value };
      for (const run of [() => setSecret(e, "kd_s", "v"), () => getSecret(e, "kd_short")]) {
        const err = await run().then(
          () => null,
          (x: Error) => x,
        );
        expect(err).not.toBeNull();
        const msg = err?.message ?? "";
        expect(msg).toContain("at least 32 characters");
        expect(msg).not.toContain("31");
        expect(msg).not.toContain(k);
        for (let i = 0; i + 6 <= k.length; i++) expect(msg).not.toContain(k.slice(i, i + 6));
      }
    }
  });
});

describe("crypto", () => {
  it("derives a different key per version", async () => {
    const k = randomKey(40);
    const sealed = await seal(await deriveKey(k, 1), "n", "t");
    expect(await open(await deriveKey(k, 1), "n", sealed.ciphertext, sealed.iv)).toBe("t");
    await expect(open(await deriveKey(k, 2), "n", sealed.ciphertext, sealed.iv)).rejects.toThrow();
  });
});
