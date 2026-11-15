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

describe("scripts/deploy.sh phases", () => {
  it("DEPLOY_PHASE=gate runs only checks, not release", () => {
    const r = run({
      ...sentinels,
      DEPLOY_DRY_RUN: "1",
      DEPLOY_PHASE: "gate",
    });
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("DRY: gate");
    expect(out).not.toContain("DRY: build");
    expect(out).not.toContain("DRY: wrangler deploy");
    expect(out).not.toContain("Live: https://");
  });

  it("DEPLOY_PHASE=release runs no gate", () => {
    const r = run({
      ...sentinels,
      DEPLOY_DRY_RUN: "1",
      DEPLOY_PHASE: "release",
    });
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).not.toContain("DRY: gate");
    expect(out).toContain("DRY: build");
    expect(out).toContain("DRY: wrangler deploy");
    expect(out).toContain("Live: https://");
  });

  it("DEPLOY_E2E=skip skips Playwright but runs checks", () => {
    const r = run({
      ...sentinels,
      DEPLOY_DRY_RUN: "1",
      DEPLOY_E2E: "skip",
    });
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("Skipping Playwright run");
    expect(out).toContain("DRY: gate");
  });

  it("DEPLOY_PHASE=gate still requires all environment variables", () => {
    const r = run({
      DEPLOY_DRY_RUN: "1",
      DEPLOY_PHASE: "gate",
    });
    expect(r.status).not.toBe(0);
    const out = r.stdout + r.stderr;
    for (const name of Object.keys(sentinels)) {
      expect(out).toContain(`Missing required environment variable: ${name}`);
    }
  });

  it("prints PHASE_SECONDS for completed gate", () => {
    const r = run({
      ...sentinels,
      DEPLOY_DRY_RUN: "1",
      DEPLOY_PHASE: "gate",
    });
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/PHASE_SECONDS checks=/);
  });

  it("prints PHASE_SECONDS for completed release", () => {
    const r = run({
      ...sentinels,
      DEPLOY_DRY_RUN: "1",
      DEPLOY_PHASE: "release",
    });
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/PHASE_SECONDS .*build=.*deploy=.*smoke=/);
  });

  it("default (no DEPLOY_PHASE) runs gate then release", () => {
    const r = run({
      ...sentinels,
      DEPLOY_DRY_RUN: "1",
    });
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("DRY: gate");
    expect(out).toContain("DRY: build");
    expect(out).toContain("DRY: wrangler deploy");
    expect(out).toContain("Live: https://");
  });
});
