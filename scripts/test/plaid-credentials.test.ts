import { spawn, spawnSync } from "node:child_process";
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
// The in-process server needs a free event loop, so this one does not block (spawnSync would).
function runAsync(env: Record<string, string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string; out: string }>(
    (resolve) => {
      const c = spawn("bash", ["scripts/plaid-credentials.sh"], {
        cwd: root,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      });
      let stdout = "";
      let stderr = "";
      c.stdout.on("data", (d) => {
        stdout += d;
      });
      c.stderr.on("data", (d) => {
        stderr += d;
      });
      c.on("close", (status) => resolve({ status, stdout, stderr, out: stdout + stderr }));
    },
  );
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
    expect(r.stdout).toBe("plaid credentials: sandbox skipped, production skipped (local)\n");
    expect(await configured()).toEqual(["sandbox:false", "production:false"]);
  });

  it("pushes only Sandbox when only its variables are set", async () => {
    const r = run(env({ PLAID_CLIENT_ID: CLIENT, PLAID_SANDBOX_SECRET: SANDBOX }));
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("plaid credentials: sandbox set, production skipped (local)\n");
    expect(noLeak(r.out)).toBe(true);
    expect(await configured()).toEqual(["sandbox:true", "production:false"]);
  });

  it("EXF-631: pushes Sandbox only when both are set (production skipped locally)", async () => {
    const r = run(
      env({
        PLAID_CLIENT_ID: CLIENT,
        PLAID_SANDBOX_SECRET: SANDBOX,
        PLAID_PRODUCTION_SECRET: PRODUCTION,
      }),
    );
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("plaid credentials: sandbox set, production skipped (local)\n");
    expect(noLeak(r.out)).toBe(true);
    expect(await configured()).toEqual(["sandbox:true", "production:false"]);
  });

  it("refuses a base URL that is not local (exit 2)", () => {
    const r = run({ PLAID_CREDENTIALS_BASE_URL: "https://example.com", PLAID_CLIENT_ID: CLIENT });
    expect(r.status).toBe(2);
    expect(noLeak(r.out)).toBe(true);
  });
});

describe("EXF-631: local mode never pushes the production secret", () => {
  const bodies: string[] = [];
  const srv = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
    });
    req.on("end", () => {
      bodies.push(b);
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
  });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());

  it("writes the sandbox secret and never the production one", async () => {
    bodies.length = 0;
    const r = await runAsync({
      PLAID_CREDENTIALS_BASE_URL: base,
      PLAID_CLIENT_ID: CLIENT,
      PLAID_SANDBOX_SECRET: SANDBOX,
      PLAID_PRODUCTION_SECRET: PRODUCTION,
    });
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("plaid credentials: sandbox set, production skipped (local)\n");
    expect(bodies.length).toBe(1);
    expect(bodies[0].includes(SANDBOX)).toBe(true);
    expect(bodies.some((b) => b.includes(PRODUCTION))).toBe(false);
    expect(noLeak(r.out)).toBe(true);
  });

  it("refuses an explicit request for production in local mode (exit 2, nothing sent)", async () => {
    bodies.length = 0;
    const r = await runAsync({
      PLAID_CREDENTIALS_BASE_URL: base,
      PLAID_CREDENTIALS_LOCAL_PRODUCTION: "1",
      PLAID_CLIENT_ID: CLIENT,
      PLAID_SANDBOX_SECRET: SANDBOX,
      PLAID_PRODUCTION_SECRET: PRODUCTION,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("production");
    expect(bodies).toEqual([]);
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
    expect(r.stdout).toBe("plaid credentials: sandbox failed, production skipped (local)\n");
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

  it("EXF-631: remote mode is unchanged: production alone is pushed", () => {
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
      PLAID_PRODUCTION_SECRET: PRODUCTION,
    });
    expect(r.stdout).toBe("plaid credentials: sandbox skipped, production set\n");
  });

  it("refuses without the Access service token (exit 2)", () => {
    const r = run({ PLAID_CLIENT_ID: CLIENT, PLAID_SANDBOX_SECRET: SANDBOX });
    expect(r.status).toBe(2);
    expect(noLeak(r.out)).toBe(true);
  });
});
