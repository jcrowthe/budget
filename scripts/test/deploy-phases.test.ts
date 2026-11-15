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
const root = new URL("../..", import.meta.url).pathname;
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

function run(env: Record<string, string>) {
  const r = spawnSync("bash", ["scripts/deploy.sh"], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
  });
  return { ...r, out: r.stdout + r.stderr };
}
const dry = { ...sentinels, DEPLOY_DRY_RUN: "1" };
const noLeak = (out: string) => {
  for (const v of Object.values(sentinels)) expect(out).not.toContain(v);
};
const GATE_LINE = /^PHASE_SECONDS checks=\d+ e2e=\d+$/m;
const RELEASE_LINE = /^PHASE_SECONDS build=\d+ resources=\d+ migrations=\d+ deploy=\d+ smoke=\d+$/m;

describe("scripts/deploy.sh phases", () => {
  it("gate runs the checks and changes nothing", () => {
    const r = run({ ...dry, DEPLOY_PHASE: "gate" });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("DRY: gate: pnpm check");
    expect(r.out).toContain("DRY: gate: pnpm e2e");
    expect(r.out).toMatch(GATE_LINE);
    for (const s of [
      "Build ",
      "Resources:",
      "DRY: POST",
      "DRY: PUT",
      "DRY: DELETE",
      "DRY: wrangler",
      "Live:",
      "DEPLOY_SHA=",
    ]) {
      expect(r.out).not.toContain(s);
    }
    noLeak(r.out);
  });

  it("release runs no gate and ends with the smoke test", () => {
    const r = run({ ...dry, DEPLOY_PHASE: "release" });
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain("DRY: gate");
    const order = [
      "DRY: build",
      "Resources: D1",
      "Cloudflare Access",
      "DNS for",
      "DRY: wrangler d1 migrations apply",
      "DRY: wrangler deploy",
      "DRY: smoke test",
    ].map((s) => r.out.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(r.out).toMatch(RELEASE_LINE);
    expect(r.out).toContain("Live: https://budget.doxen.dev");
    expect(r.out).toContain(`DEPLOY_SHA=${head}`);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    noLeak(r.out);
  });

  it("DEPLOY_E2E=skip skips only the Playwright run, in gate and in the default mode", () => {
    const g = run({ ...dry, DEPLOY_PHASE: "gate", DEPLOY_E2E: "skip" });
    expect(g.status, g.out).toBe(0);
    expect(g.out).toContain("DRY: gate: pnpm check");
    expect(g.out).not.toContain("DRY: gate: pnpm e2e");
    expect(g.out).toMatch(/^PHASE_SECONDS checks=\d+ e2e=0$/m);
    const d = run({ ...dry, DEPLOY_E2E: "skip" });
    expect(d.status, d.out).toBe(0);
    expect(d.out).toContain("DRY: gate: pnpm check");
    expect(d.out).not.toContain("DRY: gate: pnpm e2e");
    expect(d.out).toMatch(/^PHASE_SECONDS checks=\d+ e2e=0$/m);
    expect(d.out).toContain(`DEPLOY_SHA=${head}`);
    noLeak(g.out + d.out);
  });

  it("default runs the gate, then the release", () => {
    const r = run(dry);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(GATE_LINE);
    expect(r.out).toMatch(RELEASE_LINE);
    expect(r.out.indexOf("PHASE_SECONDS checks")).toBeLessThan(r.out.indexOf("DRY: build"));
    expect(r.out).toContain(`DEPLOY_SHA=${head}`);
  });

  it.each(["", "gate", "release"])("names a missing variable in phase %j", (phase) => {
    const { CF_ACCESS_CLIENT_SECRET: _omit, ...rest } = sentinels;
    const r = run({ ...rest, DEPLOY_DRY_RUN: "1", ...(phase ? { DEPLOY_PHASE: phase } : {}) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Missing required environment variable: CF_ACCESS_CLIENT_SECRET");
    expect(r.out).not.toContain("Gate");
    expect(r.out).not.toContain("Build");
    expect(r.out).not.toContain("DRY:");
    noLeak(r.out);
  });

  it("refuses an unknown phase before anything runs", () => {
    const r = run({ ...dry, DEPLOY_PHASE: "relase" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("DEPLOY_PHASE must be unset, gate or release");
    expect(r.out).not.toContain("DRY:");
    noLeak(r.out);
  });
});
