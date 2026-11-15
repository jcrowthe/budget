// Helper for flow tests that drive a real browser against the live clone behind Cloudflare Access.
// Reads CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET from the environment; never prints values.
//
//   import { attachAccess } from "./scripts/access-browser.mjs";
//   await attachAccess(context);            // adds the two service-token headers for budget.doxen.dev only
//
//   node scripts/access-browser.mjs storage-state <out.json>
//     Calls the health endpoint with the headers. If Access issues a CF_Authorization cookie, writes a
//     Playwright storageState (mode 0600) and exits 0. In strict service-token mode (the default for orgs
//     created on or after 2026-10-05) Access issues no cookie: exit 3, use attachAccess() instead.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_HOST = "budget.doxen.dev";

function creds() {
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!id) throw new Error("Missing required environment variable: CF_ACCESS_CLIENT_ID");
  if (!secret) throw new Error("Missing required environment variable: CF_ACCESS_CLIENT_SECRET");
  return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
}

/** Adds the service-token headers to every request the context sends to `host` (and only that host). */
export async function attachAccess(context, { host = DEFAULT_HOST } = {}) {
  const headers = creds();
  await context.route(
    (url) => url.hostname === host,
    (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
}

async function storageState(out, host = DEFAULT_HOST) {
  const res = await fetch(`https://${host}/api/v1/health`, {
    headers: creds(),
    redirect: "manual",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const raw = setCookies.find((c) => c.startsWith("CF_Authorization="));
  if (!raw) {
    console.error(
      "Access issued no cookie (strict service-token mode): use attachAccess() instead of a cookie.",
    );
    return 3;
  }
  const value = raw.split(";")[0].slice("CF_Authorization=".length);
  const state = {
    cookies: [
      {
        name: "CF_Authorization",
        value,
        domain: host,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
  writeFileSync(out, JSON.stringify(state), { mode: 0o600 });
  console.log(`storageState written to ${out}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, out] = process.argv.slice(2);
  if (cmd !== "storage-state" || !out) {
    console.error("usage: node scripts/access-browser.mjs storage-state <out.json>");
    process.exit(2);
  }
  try {
    process.exit(await storageState(out));
  } catch (e) {
    console.error(e instanceof Error ? e.message : "failed");
    process.exit(1);
  }
}
