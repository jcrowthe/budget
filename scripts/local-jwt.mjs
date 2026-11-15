// Signs a local test token (HS256, iss/aud budget-local) with the secret in apps/worker/.dev.vars.
// As a CLI it writes the token only to --out <file> (mode 0600), never to stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";

const devVars = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "worker", ".dev.vars");

function secret() {
  const line = readFileSync(devVars, "utf8")
    .split("\n")
    .find((l) => l.startsWith("LOCAL_JWT_SECRET="));
  if (!line) throw new Error("LOCAL_JWT_SECRET missing: run node scripts/dev-vars.mjs");
  return new TextEncoder().encode(line.slice("LOCAL_JWT_SECRET=".length));
}

export async function localToken({ email = "dev@localhost", ttl = "12h" } = {}) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("budget-local")
    .setAudience("budget-local")
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : undefined;
  if (!out) {
    console.error("usage: node scripts/local-jwt.mjs --out <file>");
    process.exit(2);
  }
  writeFileSync(out, await localToken(), { mode: 0o600 });
  console.log(`token written to ${out}`);
}
