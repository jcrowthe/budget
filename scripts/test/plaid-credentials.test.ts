import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDevServer } from "./support/dev-server";
import { makeFakeCurl } from "./support/fake-curl";

const root = new URL("../..", import.meta.url).pathname;
// Fake values: never a real credential.
const CLIENT = "PLAID-CLIENT-SENTINEL-1";
const SANDBOX = "PLAID-SANDBOX-SENTINEL-2";
const PRODUCTION = "PLAID-PRODUCTION-SENTINEL-3";
const ACCESS_ID = "sentinel-access-id-aaa111";
const ACCESS_SECRET = "sentinel-access-secret-bbb222";
const SENTINELS = [CLIENT, SANDBOX, PRODUCTION, ACCESS_ID, ACCESS_SECRET];

function run(env: Record<string, string>) {
  const r = spawnSync("bash", ["scripts/plaid-credentials.sh"], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
  });
  return { ...r, out: r.stdout + r.stderr };
}
const noLeak = (text: string) => SENTINELS.every((s) => !text.includes(s));

describe("against the local dev server", () => {
  let server: Awaited<ReturnType<typeof startDevServer>>;
  const env = (extra: Record<string, string> = {}) => ({
    PLAID_CREDENTIALS_BASE_URL: server.base,
    ...extra,
  });
  const configured = async () =>
    (
      (await (await fetch(`${server.base}/api/v1/plaid/credentials`)).json()) as {
        data: { credentials: { environment: string; configured: boolean }[] };
      }
    ).data.credentials.map((c) => `${c.environment}:${c.configured}`);

  beforeAll(async () => {
    server = await startDevServer();
  }, 180_000);
  afterAll(() => server?.stop());

  it("skips both when nothing is set (exit 0)", async () => {
    const r = run(env());
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("plaid credentials: sandbox skipped, production skipped\n");
    expect(await configured()).toEqual(["sandbox:false", "production:false"]);
  });

  it("pushes only Sandbox when only its variables are set", async () => {
    const r = run(env({ PLAID_CLIENT_ID: CLIENT, PLAID_SANDBOX_SECRET: SANDBOX }));
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("plaid credentials: sandbox set, production skipped\n");
    expect(noLeak(r.out)).toBe(true);
    expect(await configured()).toEqual(["sandbox:true", "production:false"]);
  });

  it("pushes both when both are set", async () => {
    const r = run(
      env({
        PLAID_CLIENT_ID: CLIENT,
        PLAID_SANDBOX_SECRET: SANDBOX,
        PLAID_PRODUCTION_SECRET: PRODUCTION,
      }),
    );
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("plaid credentials: sandbox set, production set\n");
    expect(noLeak(r.out)).toBe(true);
    expect(await configured()).toEqual(["sandbox:true", "production:true"]);
  });

  it("refuses a base URL that is not local (exit 2)", () => {
    const r = run({ PLAID_CREDENTIALS_BASE_URL: "https://example.com", PLAID_CLIENT_ID: CLIENT });
    expect(r.status).toBe(2);
    expect(noLeak(r.out)).toBe(true);
  });
});

describe("a failing server", () => {
  const srv = createServer((_req, res) => {
    res.statusCode = 500;
    res.end("{}");
  });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());

  it("prints failed and exits 1", () => {
    const r = run({
      PLAID_CREDENTIALS_BASE_URL: base,
      PLAID_CLIENT_ID: CLIENT,
      PLAID_SANDBOX_SECRET: SANDBOX,
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("plaid credentials: sandbox failed, production skipped\n");
    expect(noLeak(r.out)).toBe(true);
  });
});

describe("live mode", () => {
  const fake = makeFakeCurl();
  afterAll(() => fake.cleanup());

  it("keeps every value out of argv and sends both Access headers in a config", () => {
    const r = run({
      PATH: `${fake.bin}:${process.env.PATH}`,
      FAKE_CURL_LOG: fake.log,
      FAKE_CURL_ROUTES: JSON.stringify({
        "PUT https://budget.doxen.dev/api/v1/plaid/credentials": {
          status: 200,
          body: { data: {} },
        },
      }),
      CF_ACCESS_CLIENT_ID: ACCESS_ID,
      CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
      PLAID_CLIENT_ID: CLIENT,
      PLAID_SANDBOX_SECRET: SANDBOX,
      PLAID_PRODUCTION_SECRET: PRODUCTION,
    });
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("plaid credentials: sandbox set, production set\n");
    const log = readFileSync(fake.log, "utf8");
    expect(noLeak(log)).toBe(true);
    expect(noLeak(r.out)).toBe(true);
    expect(log).toContain("CONFIG: CF-Access-Client-Id CF-Access-Client-Secret");
    expect(log).toMatch(/ -K /);
  });

  it("refuses without the Access service token (exit 2)", () => {
    const r = run({ PLAID_CLIENT_ID: CLIENT, PLAID_SANDBOX_SECRET: SANDBOX });
    expect(r.status).toBe(2);
    expect(noLeak(r.out)).toBe(true);
  });
});
