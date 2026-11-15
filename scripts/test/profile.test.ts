import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;
const raw = readFileSync(`${root}clone.profile.json`, "utf8");
// biome-ignore lint/suspicious/noExplicitAny: the profile is free-form JSON
const profile: any = JSON.parse(raw);

// The YNAB plan "Test Budget": the only source plan a child may open.
const TEST_PLAN_ID = "542b334b-696e-4418-937a-5e2c21a8b45c";

const REQUIRED = [
  ..."install check e2e_full e2e_specs repeat_flag deploy deploy_phases migrations_pending workers_flag dev"
    .split(" ")
    .map((k) => `repo.${k}`),
  "health.path",
  "health.version_field",
  "health.dev_url",
  "source.url",
  "source.single_tab",
  "source.signed_out_markers",
  "source.driver",
  ..."docs_dir screenshots_dir scratch_dir shared_modules always_overlap web_ui tests sensitive docs_index e2e_state_dir"
    .split(" ")
    .map((k) => `paths.${k}`),
  "paths.migrations.dir",
  ..."url test_space test_prefix health_path auth_headers_from_env auth.env auth.headers auth.scripts auth.browser recipes.get recipes.create recipes.delete recipes.purge recipes.delete_import recipes.routes never_run never_touch deploy access deploy_env access.headers access.browser_helper source_test_space"
    .split(" ")
    .map((k) => `live.${k}`),
  "ports.dev_web",
  "ports.dev_api",
  "ports.e2e_web",
  "ports.e2e_api",
  "box.cpu_count",
  "box.e2e_full_lock",
];

function get(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: walking free-form JSON
  return path.split(".").reduce((o: any, k) => o?.[k], profile);
}

describe("clone.profile.json", () => {
  it.each(REQUIRED)("has %s", (path) => {
    const v = get(path);
    expect(v, path).not.toBeUndefined();
    expect(v, path).not.toBeNull();
    expect(v, path).not.toBe("");
    if (Array.isArray(v)) expect(v.length, path).toBeGreaterThan(0);
  });

  it("points source.url at the Test Budget plan only", () => {
    // The bare site opens whichever plan was used last, which may hold private data.
    expect(profile.source.url).toMatch(new RegExp(`^https://app\\.ynab\\.com/${TEST_PLAN_ID}/`));
    expect(profile.source.url).toContain(TEST_PLAN_ID);
    expect(profile.live.source_test_space).toContain(profile.source.url);
  });

  it("has the expected values", () => {
    expect(profile.repo.deploy).toBe("bash scripts/deploy.sh");
    expect(profile.live.deploy).toBe("bash scripts/deploy.sh");
    expect(profile.repo.deploy_phases).toBe(true);
    expect(profile.repo.migrations_pending).toBe("bash scripts/migrations-pending.sh");
    expect(profile.health.version_field).toBe("deploy_sha");
    expect(profile.source.driver).toBe("cdp");
    expect(profile.live.health_path).toBe(profile.health.path);
    const map = {
      "CF-Access-Client-Id": "CF_ACCESS_CLIENT_ID",
      "CF-Access-Client-Secret": "CF_ACCESS_CLIENT_SECRET",
    };
    expect(profile.live.auth_headers_from_env).toEqual(map);
    expect(profile.live.auth.env).toEqual(Object.values(map));
    expect(profile.live.auth.headers).toEqual(Object.keys(map));
    expect(profile.live.recipes.delete_import).toBe("Not applicable yet: the app has no imports.");
    for (const k of ["get", "create", "delete", "purge"]) {
      expect(profile.live.recipes[k]).toMatch(/^bash scripts\/live-test-plans\.sh /);
    }
  });

  it("lists the never_run and never_touch lines", () => {
    const run: string[] = profile.live.never_run;
    for (const line of [
      "wrangler d1 execute --remote with any statement other than SELECT",
      "wrangler delete, wrangler d1 delete, wrangler r2 bucket delete, wrangler secret delete",
      "wrangler secret put or bulk outside scripts/deploy.sh",
      "wrangler d1 time-travel restore without the person's say-so",
      "any Cloudflare API call that creates, changes or deletes a resource not named for this app (Worker budget, D1 budget-db, R2 budget-files, Access applications budget and budget-mcp, Access policies budget-allow-owner and budget-service-auth, the DNS record named exactly budget.doxen.dev)",
      "anything that changes or deletes the wildcard DNS record *.doxen.dev",
      "scripts/deploy.sh with DEPLOY_PHASE=release or unset outside the Deploy template",
      "any Plaid call against the production environment that creates, updates or removes an Item",
    ]) {
      expect(run).toContain(line);
    }
    expect(profile.live.never_touch).toContain(
      "Cloudflare Workers, D1 databases, R2 buckets, Access applications, policies, service tokens and DNS records that are not named for this app (the account holds the person's other resources)",
    );
    expect(profile.live.never_touch.length).toBeGreaterThanOrEqual(4);
  });

  it("names only scripts that exist, and runs executable shell scripts", () => {
    const names = new Set(raw.match(/scripts\/[A-Za-z0-9_./-]+\.(sh|mjs)/g) ?? []);
    expect(names.size).toBeGreaterThan(0);
    for (const n of names) expect(existsSync(`${root}${n}`), n).toBe(true);
    for (const n of [
      "scripts/deploy.sh",
      "scripts/migrations-pending.sh",
      "scripts/live-test-plans.sh",
    ]) {
      expect(statSync(`${root}${n}`).mode & 0o111, n).not.toBe(0);
    }
  });
});
