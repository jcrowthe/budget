import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const sentinels = {
  CLOUDFLARE_API_TOKEN: "sentinel-token-aaa111",
  CLOUDFLARE_ACCOUNT_ID: "sentinel-account-bbb222",
  CF_ACCESS_TEAM_DOMAIN: "sentinel-team-ccc333.cloudflareaccess.com",
  ACCESS_ALLOWED_EMAIL: "sentinel-owner-ddd444@example.invalid",
  CF_ACCESS_CLIENT_ID: "sentinel-client-eee555",
  CF_ACCESS_CLIENT_SECRET: "sentinel-secret-fff666",
  SECRETS_ENCRYPTION_KEY: "sentinel-key-ggg777",
};

function run(env: Record<string, string>) {
  return spawnSync("bash", ["scripts/deploy.sh"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
  });
}

describe("scripts/deploy.sh", () => {
  it("refuses cleanly, naming every missing key, before anything runs", () => {
    const r = run({});
    expect(r.status).not.toBe(0);
    const out = r.stdout + r.stderr;
    for (const name of Object.keys(sentinels)) {
      expect(out).toContain(`Missing required environment variable: ${name}`);
    }
    expect(out).not.toContain("Gate");
    expect(out.indexOf("CLOUDFLARE_API_TOKEN")).toBeLessThan(out.indexOf("CLOUDFLARE_ACCOUNT_ID"));
  });

  it("names only the keys that are missing", () => {
    const { CF_ACCESS_CLIENT_SECRET: _omit, ...rest } = sentinels;
    const r = run(rest);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("CF_ACCESS_CLIENT_SECRET");
    expect(r.stderr).not.toContain("CLOUDFLARE_API_TOKEN");
  });

  it("dry run prints release steps in order and leaks no value", () => {
    const r = run({ ...sentinels, DEPLOY_DRY_RUN: "1" });
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    const order = [
      "DRY: gate",
      "DRY: build",
      "Resources: D1",
      "D1 Time Travel",
      "Cloudflare Access",
      "DNS for",
      "DRY: wrangler d1 migrations apply",
      "DRY: wrangler deploy",
      "DRY: smoke test",
      "Live: https://budget.doxen.dev",
      "DEPLOY_SHA=",
    ].map((s) => out.indexOf(s));
    expect(
      order.every((i) => i >= 0),
      JSON.stringify(order),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toMatch(/DRY: POST \/accounts\/<account>\/access\/apps/);
    for (const v of Object.values(sentinels)) expect(out).not.toContain(v);
  });
});
