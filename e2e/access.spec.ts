import { SignJWT } from "jose";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";

// Bare requests: no cookie, no header.
test.use({ storageState: { cookies: [], origins: [] } });

test("every path refuses a request without a token", async ({ request }) => {
  for (const path of [
    "/",
    "/index.html",
    "/api/v1/health",
    "/api/v1/budgets",
    "/api/v1/openapi.json",
  ]) {
    expect((await request.get(path)).status(), path).toBe(403);
  }
  expect((await request.post("/mcp", { data: {} })).status()).toBe(403);
});

test("a token signed with the wrong secret is refused", async ({ request }) => {
  const bad = await new SignJWT({ email: "x@localhost" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("budget-local")
    .setAudience("budget-local")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("not-the-real-secret-not-the-real-secret"));
  const res = await request.get("/api/v1/health", { headers: { "Cf-Access-Jwt-Assertion": bad } });
  expect(res.status()).toBe(403);
});

test("a valid token is accepted", async ({ request }) => {
  const res = await request.get("/api/v1/health", { headers: await authHeaders() });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});
