import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteSecret } from "../src/secrets";
import { json } from "./helpers";
import { ALL_SENTINELS, SENTINEL } from "./plaid-stub";
import { apiPaths, listedToolNames } from "./surface";

type Json = Record<string, any>;
const clean = (text: string) => ALL_SENTINELS.every((s) => !text.includes(s));

describe("plaid credentials", () => {
  it("is in the API surface", async () => {
    expect(await apiPaths()).toContain("/api/v1/plaid/credentials");
  });

  it("stores encrypted, reports only which environments are set, and leaks nothing", async () => {
    await deleteSecret(env, "plaid_credentials:sandbox");
    await deleteSecret(env, "plaid_credentials:production");
    const before = (await (await json("/api/v1/plaid/credentials")).json()) as Json;
    expect(before.data.credentials).toEqual([
      { environment: "sandbox", configured: false, set_at: null },
      { environment: "production", configured: false, set_at: null },
    ]);

    const put = await json(
      "/api/v1/plaid/credentials",
      { method: "PUT", headers: { "Idempotency-Key": "plaid-cred-key" } },
      { environment: "sandbox", client_id: SENTINEL.clientId, secret: SENTINEL.secret },
    );
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(clean(putText)).toBe(true);
    expect(JSON.parse(putText).data.configured).toBe(true);

    const row = await env.DB.prepare(
      "select ciphertext from secrets where name = 'plaid_credentials:sandbox'",
    ).first<{ ciphertext: number[] }>();
    const stored = new TextDecoder().decode(new Uint8Array(row?.ciphertext ?? []));
    expect(clean(stored)).toBe(true);

    const after = await json("/api/v1/plaid/credentials");
    const afterText = await after.text();
    expect(clean(afterText)).toBe(true);
    const creds = JSON.parse(afterText).data.credentials as Json[];
    expect(creds[0]).toMatchObject({ environment: "sandbox", configured: true });
    expect(creds[0]?.set_at).toBeTruthy();
    expect(creds[1]).toMatchObject({ environment: "production", configured: false });
    expect(Object.keys(creds[0] ?? {}).sort()).toEqual(["configured", "environment", "set_at"]);

    const logs = await env.DB.prepare(
      "select before_json, after_json, entity_type from change_log where entity_type = 'plaid_credentials'",
    ).all<Json>();
    expect(logs.results.length).toBeGreaterThan(0);
    expect(clean(JSON.stringify(logs.results))).toBe(true);
    const idem = await env.DB.prepare("select * from idempotency_keys").all();
    expect(clean(JSON.stringify(idem.results))).toBe(true);
  });

  it("rejects bad input with 400", async () => {
    for (const body of [
      { environment: "staging", client_id: "a", secret: "b" },
      { environment: "sandbox", client_id: "", secret: "b" },
      { environment: "sandbox", client_id: "a" },
    ]) {
      expect((await json("/api/v1/plaid/credentials", { method: "PUT" }, body)).status).toBe(400);
    }
  });

  it("has no MCP tool for credentials", async () => {
    expect((await listedToolNames()).some((n) => n.includes("credential"))).toBe(false);
  });
});
