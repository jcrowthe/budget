import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AppEnv, Env, Identity } from "../env";

const LOCAL_ISSUER = "budget-local";
const LOCAL_AUDIENCE = "budget-local";

const jwksCache = new Map<string, JWTVerifyGetKey>();

export function teamHost(env: Pick<Env, "ACCESS_TEAM_DOMAIN">): string {
  return (env.ACCESS_TEAM_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function remoteKeys(team: string): JWTVerifyGetKey {
  let keys = jwksCache.get(team);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksCache.set(team, keys);
  }
  return keys;
}

export function readToken(req: Request): string | null {
  const header = req.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = req.headers.get("Cookie");
  if (!cookie) return null;
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return m?.[1] ?? null;
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type TokenOrigin = "local" | "access";

async function toIdentity(
  payload: JWTPayload,
  env: Env,
  origin: TokenOrigin,
): Promise<Identity | null> {
  const email = typeof payload.email === "string" && payload.email ? payload.email : null;
  if (email) {
    if (origin === "local") {
      return email.toLowerCase().endsWith("@localhost")
        ? { kind: "user", actor: `user:${email}`, email }
        : null;
    }
    // Defence in depth: the Access policy is not the only thing that decides who gets in.
    const allowed = (env.ACCESS_ALLOWED_EMAIL ?? "").trim().toLowerCase();
    return allowed !== "" && email.trim().toLowerCase() === allowed
      ? { kind: "user", actor: `user:${email}`, email }
      : null;
  }
  const clientId = typeof payload.common_name === "string" ? payload.common_name : null;
  // Service tokens carry common_name and an empty sub; anything else without an email is refused.
  if (!clientId || payload.sub) return null;
  try {
    const map = JSON.parse(env.ACCESS_SERVICE_TOKENS || "{}") as unknown;
    if (!map || typeof map !== "object") return null;
    const found = (map as Record<string, unknown>)[await sha256Hex(clientId)];
    // an unknown token or a malformed map is refused, never recorded as an anonymous service
    return typeof found === "string" && found
      ? { kind: "service", actor: `service:${found}` }
      : null;
  } catch {
    return null;
  }
}

/** Returns the identity for a valid token, or null. Fails closed on any problem. */
export async function identify(
  token: string | null,
  env: Env,
  getKey?: JWTVerifyGetKey,
): Promise<Identity | null> {
  if (!token) return null;
  try {
    if (env.ENVIRONMENT === "local" && env.LOCAL_JWT_SECRET) {
      let local: JWTPayload | null = null;
      try {
        local = (
          await jwtVerify(token, new TextEncoder().encode(env.LOCAL_JWT_SECRET), {
            issuer: LOCAL_ISSUER,
            audience: LOCAL_AUDIENCE,
            algorithms: ["HS256"],
          })
        ).payload;
      } catch {
        // not a local token: fall through to the Access JWKS check
      }
      if (local) return await toIdentity(local, env, "local");
    }
    const team = teamHost(env);
    // ACCESS_AUD may list several audience tags, comma separated (the /mcp app has its own).
    const audiences = (env.ACCESS_AUD ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (!team || audiences.length === 0) return null;
    const { payload } = await jwtVerify(token, getKey ?? remoteKeys(team), {
      issuer: `https://${team}`,
      audience: audiences,
      algorithms: ["RS256"],
    });
    return await toIdentity(payload, env, "access");
  } catch {
    return null;
  }
}

export function accessMiddleware(opts: { getKey?: JWTVerifyGetKey } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const identity = await identify(readToken(c.req.raw), c.env, opts.getKey);
    if (!identity) {
      const path = new URL(c.req.url).pathname;
      if (path.startsWith("/api/") || path === "/mcp") {
        return c.json({ error: { id: "403", name: "forbidden", detail: "Forbidden" } }, 403);
      }
      return c.text("Forbidden", 403);
    }
    c.set("identity", identity);
    await next();
  });
}
