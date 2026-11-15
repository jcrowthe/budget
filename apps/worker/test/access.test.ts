import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { call, localToken } from "./helpers";

const TEAM = "test.cloudflareaccess.com";
let privateKey: CryptoKey;
let getKey: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  getKey = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "k1" }],
  });
});

const rs = (claims: Record<string, unknown>, aud = "test-aud") =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(aud)
    .setExpirationTime("1h")
    .sign(privateKey);

const prod = { ENVIRONMENT: "production" };
const withToken = (t: string) => ({ headers: { "Cf-Access-Jwt-Assertion": t } });

describe("access middleware", () => {
  it("refuses a request without a token", async () => {
    const res = await call("/api/v1/health");
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { name: string } }).toMatchObject({
      error: { name: "forbidden" },
    });
  });
  it("refuses static assets without a token", async () => {
    expect((await call("/index.html")).status).toBe(403);
    expect((await call("/")).status).toBe(403);
    expect((await call("/mcp", { method: "POST" })).status).toBe(403);
  });
  it("refuses a local token signed with the wrong secret", async () => {
    const bad = await new SignJWT({ email: "x@localhost" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("budget-local")
      .setAudience("budget-local")
      .sign(new TextEncoder().encode("another-secret-another-secret-123"));
    expect((await call("/api/v1/health", withToken(bad))).status).toBe(403);
  });
  it("accepts a local token when ENVIRONMENT is local", async () => {
    expect((await call("/api/v1/health", withToken(await localToken()))).status).toBe(200);
  });
  it("accepts the token from the CF_Authorization cookie", async () => {
    const res = await call("/api/v1/health", {
      headers: { Cookie: `CF_Authorization=${await localToken()}` },
    });
    expect(res.status).toBe(200);
  });
  it("PRODUCTION CONFIG REFUSES THE LOCAL TEST TOKEN", async () => {
    const res = await call("/api/v1/health", withToken(await localToken()), prod);
    expect(res.status).toBe(403);
  });
  it("accepts an Access RS256 token with the right issuer and audience", async () => {
    const t = await rs({ email: "me@example.test", sub: "u1" });
    const res = await createApp({ getKey }).request("/api/v1/health", withToken(t), {
      ...env,
      ...prod,
    });
    expect(res.status).toBe(200);
  });
  it("refuses a wrong audience", async () => {
    const t = await rs({ email: "me@example.test" }, "other-aud");
    const res = await createApp({ getKey }).request("/api/v1/health", withToken(t), {
      ...env,
      ...prod,
    });
    expect(res.status).toBe(403);
  });
  it("refuses everything when ACCESS_AUD is missing in production", async () => {
    const t = await rs({ email: "me@example.test" });
    const res = await createApp({ getKey }).request("/api/v1/health", withToken(t), {
      ...env,
      ...prod,
      ACCESS_AUD: "",
    });
    expect(res.status).toBe(403);
  });
  it("derives service:<name> from common_name", async () => {
    const clientId = "client-abc.access";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const t = await rs({ common_name: clientId, sub: "" });
    const res = await createApp({ getKey }).request(
      "/api/v1/budgets",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": t, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "ZZ-TEST svc" }),
      },
      { ...env, ...prod, ACCESS_SERVICE_TOKENS: JSON.stringify({ [hex]: "ci-token" }) },
    );
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { data: { budget: { id: string } } }).data.budget.id;
    const row = await env.DB.prepare("SELECT actor FROM change_log WHERE entity_id = ?")
      .bind(id)
      .first<{ actor: string }>();
    expect(row?.actor).toBe("service:ci-token");
  });
  it("accepts any audience from a comma-separated ACCESS_AUD", async () => {
    const t = await rs({ email: "me@example.test" }, "mcp-aud");
    const res = await createApp({ getKey }).request("/api/v1/health", withToken(t), {
      ...env,
      ...prod,
      ACCESS_AUD: "test-aud, mcp-aud",
    });
    expect(res.status).toBe(200);
  });
  it("does not map a token with a sub and no email to a service actor", async () => {
    const t = await rs({ common_name: "client-x", sub: "user-uuid" });
    const res = await createApp({ getKey }).request("/api/v1/health", withToken(t), {
      ...env,
      ...prod,
    });
    expect(res.status).toBe(403);
  });
});
