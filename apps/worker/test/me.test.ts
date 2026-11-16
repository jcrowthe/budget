import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { call, json } from "./helpers";
import { apiPaths } from "./surface";

describe("GET /api/v1/me", () => {
  it("answers the local user's email", async () => {
    const res = await json("/api/v1/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { kind: "user", email: "tester@localhost" } });
  });
  it("answers a service token's name", async () => {
    const pair = await generateKeyPair("RS256");
    const getKey = createLocalJWKSet({
      keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "k1" }],
    });
    const clientId = "client-abc.access";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const t = await new SignJWT({ common_name: clientId, sub: "" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://test.cloudflareaccess.com")
      .setAudience("test-aud")
      .setExpirationTime("1h")
      .sign(pair.privateKey);
    const res = await createApp({ getKey }).request(
      "/api/v1/me",
      { headers: { "Cf-Access-Jwt-Assertion": t } },
      {
        ...env,
        ENVIRONMENT: "production",
        ACCESS_ALLOWED_EMAIL: "owner@example.test",
        ACCESS_SERVICE_TOKENS: JSON.stringify({ [hex]: "ci-token" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { kind: "service", name: "ci-token" } });
  });
  it("refuses a request without a token", async () => {
    expect((await call("/api/v1/me")).status).toBe(403);
  });
  it("is documented", async () => {
    expect(await apiPaths()).toContain("/api/v1/me");
  });
});
