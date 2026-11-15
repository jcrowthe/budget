import { env } from "cloudflare:test";
import { SignJWT } from "jose";
import { createApp } from "../src/app";
import type { Env } from "../src/env";

export async function localToken(claims: Record<string, unknown> = { email: "tester@localhost" }) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("budget-local")
    .setAudience("budget-local")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.LOCAL_JWT_SECRET));
}

export async function authed(init: RequestInit = {}): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  headers.set("Cf-Access-Jwt-Assertion", await localToken());
  return { ...init, headers };
}

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

export function call(path: string, init?: RequestInit, envOverride: Partial<Env> = {}) {
  return createApp().request(path, init, { ...env, ...envOverride }, ctx);
}

export async function json(path: string, init: RequestInit = {}, body?: unknown) {
  const headers = new Headers(init.headers);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const res = await call(
    path,
    await authed({ ...init, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  return res;
}
