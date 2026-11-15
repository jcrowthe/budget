import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { makeFakeCurl } from "./support/fake-curl";

const root = new URL("../..", import.meta.url).pathname;
const TOKEN = "sentinel-token-aaa111";
const ACCOUNT = "sentinel-account-bbb222";
const local = readdirSync(`${root}apps/worker/migrations`)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const fake = makeFakeCurl();
afterAll(() => fake.cleanup());

const LIST = "GET https://api.cloudflare.com/client/v4/accounts";
const dbList = {
  status: 200,
  body: { success: true, result: [{ name: "budget-db", uuid: "u1" }] },
};
const query = (names: string[]) => ({
  status: 200,
  body: { success: true, result: [{ results: names.map((name) => ({ name })), success: true }] },
});

function run(routes: object, env: Record<string, string> = {}) {
  const r = spawnSync("bash", ["scripts/migrations-pending.sh"], {
    cwd: root,
    env: {
      PATH: `${fake.bin}:${process.env.PATH}`,
      HOME: process.env.HOME ?? "",
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      FAKE_CURL_LOG: fake.log,
      FAKE_CURL_ROUTES: JSON.stringify(routes),
      ...env,
    },
    encoding: "utf8",
  });
  const log = (() => {
    try {
      return readFileSync(fake.log, "utf8");
    } catch {
      return "";
    }
  })();
  expect(log).not.toContain(TOKEN);
  expect(r.stdout + r.stderr).not.toContain(TOKEN);
  return r;
}
const lines = (s: string) => s.split("\n").filter(Boolean);

describe("scripts/migrations-pending.sh", () => {
  it("has local migrations to test with", () => expect(local.length).toBeGreaterThanOrEqual(3));

  it("prints every migration when the database does not exist", () => {
    const r = run({ [LIST]: { status: 200, body: { success: true, result: [] } } });
    expect(r.status, r.stderr).toBe(0);
    expect(lines(r.stdout)).toEqual(local);
  });

  it("prints every migration when the migrations table is missing", () => {
    const r = run({
      [LIST]: dbList,
      "POST https://api.cloudflare.com/client/v4/accounts": {
        status: 400,
        body: {
          success: false,
          errors: [{ code: 7500, message: "no such table: d1_migrations: SQLITE_ERROR" }],
        },
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(lines(r.stdout)).toEqual(local);
  });

  it("prints only the unapplied migrations", () => {
    const r = run({ "GET https://": dbList, "POST https://": query(local.slice(0, 2)) });
    expect(r.status, r.stderr).toBe(0);
    expect(lines(r.stdout)).toEqual(local.slice(2));
  });

  it("prints nothing when all are applied", () => {
    const r = run({ "GET https://": dbList, "POST https://": query(local) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fails with a message on an API error", () => {
    const r = run({
      "GET https://": dbList,
      "POST https://": {
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
      },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Authentication error");
  });

  it("exits 2 naming a missing token", () => {
    const r = run({}, { CLOUDFLARE_API_TOKEN: "" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Missing required environment variable: CLOUDFLARE_API_TOKEN");
  });
});
