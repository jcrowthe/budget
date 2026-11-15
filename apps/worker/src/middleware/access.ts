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

async function toIdentity(payload: JWTPayload, env: Env): Promise<Identity | null> {
  const email = typeof payload.email === "string" && payload.email ? payload.email : null;
  if (email) return { kind: "user", actor: `user:${email}`, email };
  const clientId = typeof payload.common_name === "string" ? payload.common_name : null;
  if (!clientId) return null;
  let name = "unknown";
  try {
    const map = JSON.parse(env.ACCESS_SERVICE_TOKENS || "{}") as Record<string, unknown>;
    const found = map[await sha256Hex(clientId)];
    if (typeof found === "string" && found) name = found;
  } catch {
    // a malformed map means "unknown", never a failure to authenticate
  }
  return { kind: "service", actor: `service:${name}` };
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
      try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(env.LOCAL_JWT_SECRET), {
          issuer: LOCAL_ISSUER,
          audience: LOCAL_AUDIENCE,
          algorithms: ["HS256"],
        });
        return await toIdentity(payload, env);
      } catch {
        // not a local token: fall through to the Access JWKS check
      }
    }
    const team = teamHost(env);
    if (!team || !env.ACCESS_AUD) return null;
    const { payload } = await jwtVerify(token, getKey ?? remoteKeys(team), {
      issuer: `https://${team}`,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
    });
    return await toIdentity(payload, env);
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
