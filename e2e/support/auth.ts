import { localToken } from "../../scripts/local-jwt.mjs";

export async function authHeaders(extra: Record<string, string> = {}) {
  return { "Cf-Access-Jwt-Assertion": await localToken({ email: "e2e@localhost" }), ...extra };
}

export const testName = (label = "") =>
  `ZZ-TEST ${label}${label ? " " : ""}${Math.random().toString(36).slice(2, 8)}`;
