import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDevServer } from "./support/dev-server";
import { makeFakeCurl } from "./support/fake-curl";

const root = new URL("../..", import.meta.url).pathname;
const CLIENT_ID = "sentinel-client-eee555";
const CLIENT_SECRET = "sentinel-secret-fff666";

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", ["scripts/live-test-plans.sh", ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
  });
  return { ...r, out: r.stdout + r.stderr };
}

describe("against the local dev server", () => {
  let server: Awaited<ReturnType<typeof startDevServer>>;
  const env = () => ({
    LIVE_TEST_PLANS_BASE_URL: server.base,
    CF_ACCESS_CLIENT_ID: CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET: CLIENT_SECRET,
  });
  const api = (method: string, path: string, body?: unknown) =>
    fetch(server.base + path, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const create = async (name: string) =>
    (
      (await (await api("POST", "/api/v1/budgets", { name })).json()) as {
        data: { budget: { id: string } };
      }
    ).data.budget.id;
  const count = async () =>
    ((await (await api("GET", "/api/v1/budgets")).json()) as { data: { budgets: unknown[] } }).data
      .budgets.length;
  const status = async (id: string) => (await api("GET", `/api/v1/budgets/${id}`)).status;

  let keepId = "";
  let zzId = "";

  beforeAll(async () => {
    server = await startDevServer();
    keepId = await create("Keep me");
  }, 180_000);
  afterAll(() => server?.stop());

  it("a. refuses to create a plan without the prefix", async () => {
    const before = await count();
    const r = run(["create", "Not a test"], env());
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ZZ-TEST");
    expect(r.out).not.toContain("Not a test");
    expect(await count()).toBe(before);
  });

  it("b. creates a prefixed plan and prints only its id", async () => {
    const r = run(["create", "ZZ-TEST one"], env());
    expect(r.status, r.out).toBe(0);
    zzId = r.stdout.trim();
    expect(zzId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await status(zzId)).toBe(200);
    // Test plans are Sandbox plans: only Plaid's test banks, never a real bank.
    const plan = (await (await api("GET", `/api/v1/budgets/${zzId}`)).json()) as {
      data: { budget: { bank_environment: string } };
    };
    expect(plan.data.budget.bank_environment).toBe("sandbox");
  });

  it("c. lists only prefixed plans", () => {
    const r = run(["list"], env());
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toContain(`${zzId}\tZZ-TEST one`);
    expect(r.out).not.toContain("Keep me");
    expect(r.out).not.toContain(keepId);
  });

  it("d. refuses to delete an unprefixed plan", async () => {
    const r = run(["delete", keepId], env());
    expect(r.status).toBe(3);
    expect(r.out).not.toContain("Keep me");
    expect(await status(keepId)).toBe(200);
  });

  it("e. deletes a prefixed plan", async () => {
    const r = run(["delete", zzId], env());
    expect(r.status, r.out).toBe(0);
    expect(r.stdout.trim()).toBe(`deleted ${zzId}`);
    expect(await status(zzId)).toBe(404);
  });

  it("f. purge deletes prefixed plans and leaves others", async () => {
    for (const i of [1, 2, 3]) await create(`ZZ-TEST p${i}`);
    const r = run(["purge"], env());
    expect(r.status, r.out).toBe(0);
    expect(r.stdout.trim()).toBe("deleted 3 remaining 0");
    expect(await status(keepId)).toBe(200);
  });

  it("g. purge refuses when more than 50 match", async () => {
    for (let i = 0; i < 51; i++) await create(`ZZ-TEST bulk${i}`);
    const r = run(["purge"], env());
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("limit 50");
    const list = run(["list"], env());
    expect(list.stdout.split("\n").filter(Boolean)).toHaveLength(51);
  }, 120_000);
});

// The in-process HTTP server needs a free event loop, so these runs must not block it.
function runAsync(args: string[], env: Record<string, string>) {
  return new Promise<{ status: number | null; out: string }>((resolve) => {
    const p = spawn("bash", ["scripts/live-test-plans.sh", ...args], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      out += d;
    });
    p.on("close", (status) => resolve({ status, out }));
  });
}

describe("auth routing", () => {
  const seen: IncomingHttpHeaders[] = [];
  let base = "";
  const srv = createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader("Content-Type", "application/json");
    res.end('{"data":{"budgets":[]}}');
  });
  beforeAll(async () => {
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    expect(spawnSync("node", ["scripts/dev-vars.mjs"], { cwd: root }).status).toBe(0);
  });
  afterAll(() => srv.close());
  const creds = { CF_ACCESS_CLIENT_ID: CLIENT_ID, CF_ACCESS_CLIENT_SECRET: CLIENT_SECRET };

  it("sends no Access service-token headers to a local server", async () => {
    const r = await runAsync(["list"], { LIVE_TEST_PLANS_BASE_URL: base, ...creds });
    expect(r.status, r.out).toBe(0);
    const h = seen.at(-1) ?? {};
    expect(h["cf-access-client-id"]).toBeUndefined();
    expect(h["cf-access-client-secret"]).toBeUndefined();
    expect(h["cf-access-jwt-assertion"]).toBeUndefined();
    expect(r.out).not.toContain(CLIENT_ID);
    expect(r.out).not.toContain(CLIENT_SECRET);
  });

  it("sends a signed token with LIVE_TEST_PLANS_LOCAL_JWT=1, and never prints it", async () => {
    const r = await runAsync(["list"], {
      LIVE_TEST_PLANS_BASE_URL: base,
      LIVE_TEST_PLANS_LOCAL_JWT: "1",
      ...creds,
    });
    expect(r.status, r.out).toBe(0);
    const h = seen.at(-1) ?? {};
    expect(h["cf-access-client-id"]).toBeUndefined();
    const token = h["cf-access-jwt-assertion"];
    expect(String(token)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(r.out).not.toContain(String(token));
  });

  it("refuses a non-local base URL, and the JWT flag without an override", () => {
    const j = run(["list"], { LIVE_TEST_PLANS_LOCAL_JWT: "1", ...creds });
    expect(j.status).toBe(2);
  });
});

describe("live mode", () => {
  const fake = makeFakeCurl();
  afterAll(() => fake.cleanup());
  const log = () => {
    try {
      return readFileSync(fake.log, "utf8");
    } catch {
      return "";
    }
  };
  const live = (args: string[], env: Record<string, string>) => {
    const r = run(args, {
      PATH: `${fake.bin}:${process.env.PATH}`,
      FAKE_CURL_LOG: fake.log,
      FAKE_CURL_ROUTES: JSON.stringify({
        "GET https://budget.doxen.dev/api/v1/budgets": {
          status: 200,
          body: {
            data: {
              budgets: [
                { id: "11111111-1111-1111-1111-111111111111", name: "ZZ-TEST a" },
                { id: "22222222-2222-2222-2222-222222222222", name: "Mine" },
              ],
            },
          },
        },
      }),
      ...env,
    });
    return r;
  };

  it("calls the live URL with the headers in a curl config, not in argv", () => {
    const r = live(["list"], {
      CF_ACCESS_CLIENT_ID: CLIENT_ID,
      CF_ACCESS_CLIENT_SECRET: CLIENT_SECRET,
    });
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe("11111111-1111-1111-1111-111111111111\tZZ-TEST a\n");
    expect(r.out).not.toContain("Mine");
    const l = log();
    expect(l).toContain("https://budget.doxen.dev/api/v1/budgets");
    expect(l).toMatch(/ -K /);
    expect(l).toContain("CONFIG: CF-Access-Client-Id CF-Access-Client-Secret");
    expect(l).not.toContain(CLIENT_ID);
    expect(l).not.toContain(CLIENT_SECRET);
  });

  it("fails (exit 1, no 'remaining 0') when the re-list after a purge answers 500", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const list = { data: { budgets: [{ id, name: "ZZ-TEST a" }] } };
    const r = live(["purge"], {
      CF_ACCESS_CLIENT_ID: CLIENT_ID,
      CF_ACCESS_CLIENT_SECRET: CLIENT_SECRET,
      FAKE_CURL_ROUTES: JSON.stringify({
        "GET https://budget.doxen.dev/api/v1/budgets/": {
          status: 200,
          body: { data: { budget: { id, name: "ZZ-TEST a" } } },
        },
        "DELETE https://budget.doxen.dev/api/v1/budgets/": {
          status: 200,
          body: { data: { deleted: true } },
        },
        "GET https://budget.doxen.dev/api/v1/budgets": {
          seq: [
            { status: 200, body: list },
            { status: 500, body: {} },
          ],
        },
      }),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("answered 500");
    expect(r.out).not.toContain("remaining");
  });

  it("refuses a non-local base URL override and never calls curl", () => {
    const before = log();
    const r = live(["list"], {
      LIVE_TEST_PLANS_BASE_URL: "https://example.com",
      CF_ACCESS_CLIENT_ID: CLIENT_ID,
      CF_ACCESS_CLIENT_SECRET: CLIENT_SECRET,
    });
    expect(r.status).toBe(2);
    expect(log()).toBe(before);
  });

  it("names both missing variables and never calls curl", () => {
    const before = log();
    const r = live(["list"], {});
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("CF_ACCESS_CLIENT_ID");
    expect(r.stderr).toContain("CF_ACCESS_CLIENT_SECRET");
    expect(log()).toBe(before);
  });

  it.each([
    [[]],
    [["frobnicate"]],
    [["create"]],
    [["create", "NoPrefix"]],
    [["delete", "not-a-uuid"]],
  ])("refuses %j with exit 2 and no request", (args) => {
    const before = log();
    const r = live(args, {
      CF_ACCESS_CLIENT_ID: CLIENT_ID,
      CF_ACCESS_CLIENT_SECRET: CLIENT_SECRET,
    });
    expect(r.status).toBe(2);
    expect(log()).toBe(before);
  });
});
