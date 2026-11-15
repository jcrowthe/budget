// Adds the missing local-development keys to apps/worker/.dev.vars (mode 0600). Prints no values.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "worker", ".dev.vars");
const defaults = {
  ENVIRONMENT: "local",
  PUBLIC_HOSTNAME: "localhost",
  ACCESS_TEAM_DOMAIN: "local",
  ACCESS_AUD: "budget-local",
  ACCESS_SERVICE_TOKENS: "{}",
  DEPLOY_SHA: "local",
  LOCAL_JWT_SECRET: () => randomBytes(32).toString("base64"),
  // any string of at least 32 characters; the Worker derives the AES key with HKDF
  SECRETS_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
};

const text = existsSync(file) ? readFileSync(file, "utf8") : "";
const have = new Set(
  text
    .split("\n")
    .map((l) => l.split("=")[0]?.trim())
    .filter(Boolean),
);
const added = [];
let out = text && !text.endsWith("\n") ? `${text}\n` : text;
for (const [key, value] of Object.entries(defaults)) {
  if (have.has(key)) continue;
  out += `${key}=${typeof value === "function" ? value() : value}\n`;
  added.push(key);
}
if (added.length || !existsSync(file)) writeFileSync(file, out, { mode: 0o600 });
chmodSync(file, 0o600);
console.log(added.length ? `dev-vars: added ${added.join(", ")}` : "dev-vars: up to date");
