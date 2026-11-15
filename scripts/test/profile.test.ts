import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;

interface Profile {
  repo?: {
    deploy?: string;
    deploy_phases?: boolean;
    migrations_pending?: string;
    install?: string;
    check?: string;
    e2e_full?: string;
    e2e_specs?: string;
    repeat_flag?: string;
    workers_flag?: string;
  };
  health?: {
    version_field?: string;
    path?: string;
    dev_url?: string;
  };
  source?: {
    driver?: string;
    url?: string;
    single_tab?: boolean;
    signed_out_markers?: string[];
  };
  paths?: {
    docs_dir?: string;
    screenshots_dir?: string;
    scratch_dir?: string;
    shared_modules?: string[];
    always_overlap?: string[];
  };
  live?: {
    url?: string;
    test_prefix?: string;
    test_space?: string;
    health_path?: string;
    auth_headers_from_env?: Record<string, string>;
    auth?: {
      env?: string[];
      headers?: string[];
      scripts?: string;
      browser?: string;
    };
    recipes?: {
      get?: string;
      create?: string;
      delete?: string;
      purge?: string;
      delete_import?: string;
      routes?: string;
    };
    never_run?: string[];
    never_touch?: string[];
  };
}

function loadProfile(): Profile {
  const profilePath = new URL("../../clone.profile.json", import.meta.url).pathname;
  const content = readFileSync(profilePath, "utf8");
  return JSON.parse(content) as Profile;
}

function fileExists(path: string): boolean {
  return existsSync(new URL(path, `file://${root}/`).pathname);
}

describe("clone.profile.json configuration", () => {
  const profile = loadProfile();

  it("has all required repo keys", () => {
    expect(profile.repo).toBeDefined();
    expect(profile.repo?.deploy).toBeDefined();
    expect(profile.repo?.deploy_phases).toBe(true);
    expect(profile.repo?.migrations_pending).toBeDefined();
    expect(profile.repo?.install).toBeDefined();
    expect(profile.repo?.check).toBeDefined();
    expect(profile.repo?.e2e_full).toBeDefined();
    expect(profile.repo?.e2e_specs).toBeDefined();
    expect(profile.repo?.repeat_flag).toBeDefined();
  });

  it("has all required health keys", () => {
    expect(profile.health).toBeDefined();
    expect(profile.health?.version_field).toBe("deploy_sha");
    expect(profile.health?.path).toBeDefined();
  });

  it("has all required source keys", () => {
    expect(profile.source).toBeDefined();
    expect(profile.source?.driver).toBe("cdp");
    expect(profile.source?.url).toBeDefined();
    expect(profile.source?.single_tab).toBeDefined();
    expect(profile.source?.signed_out_markers).toBeDefined();
  });

  it("has all required paths keys", () => {
    expect(profile.paths).toBeDefined();
    expect(profile.paths?.docs_dir).toBeDefined();
    expect(profile.paths?.screenshots_dir).toBeDefined();
    expect(profile.paths?.scratch_dir).toBeDefined();
    expect(profile.paths?.shared_modules).toBeDefined();
    expect(profile.paths?.always_overlap).toBeDefined();
  });

  it("has all required live keys", () => {
    expect(profile.live).toBeDefined();
    expect(profile.live?.url).toBeDefined();
    expect(profile.live?.test_prefix).toBeDefined();
    expect(profile.live?.test_space).toBeDefined();
    expect(profile.live?.health_path).toBe("/api/v1/health");
    expect(profile.live?.auth_headers_from_env).toBeDefined();
    expect(profile.live?.auth).toBeDefined();
    expect(profile.live?.recipes).toBeDefined();
    expect(profile.live?.never_run).toBeDefined();
    expect(profile.live?.never_touch).toBeDefined();
  });

  it("has auth_headers_from_env with correct structure", () => {
    const headers = profile.live?.auth_headers_from_env;
    expect(headers).toBeDefined();
    expect(headers?.["CF-Access-Client-Id"]).toBe("CF_ACCESS_CLIENT_ID");
    expect(headers?.["CF-Access-Client-Secret"]).toBe("CF_ACCESS_CLIENT_SECRET");
  });

  it("has auth with required fields", () => {
    const auth = profile.live?.auth;
    expect(auth?.env).toEqual(["CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]);
    expect(auth?.headers).toEqual(["CF-Access-Client-Id", "CF-Access-Client-Secret"]);
    expect(auth?.scripts).toBeDefined();
    expect(auth?.browser).toBeDefined();
  });

  it("has recipes with all required commands", () => {
    const recipes = profile.live?.recipes;
    expect(recipes?.get).toBeDefined();
    expect(recipes?.create).toBeDefined();
    expect(recipes?.delete).toBeDefined();
    expect(recipes?.purge).toBeDefined();
    expect(recipes?.delete_import).toBeDefined();
    expect(recipes?.routes).toBeDefined();
  });

  it("has never_run restrictions", () => {
    const neverRun = profile.live?.never_run;
    expect(neverRun).toBeDefined();
    expect(Array.isArray(neverRun)).toBe(true);
    expect(neverRun?.length).toBeGreaterThan(0);
  });

  it("has never_touch restrictions", () => {
    const neverTouch = profile.live?.never_touch;
    expect(neverTouch).toBeDefined();
    expect(Array.isArray(neverTouch)).toBe(true);
    expect(neverTouch?.length).toBeGreaterThan(0);
  });

  it("referenced scripts exist", () => {
    expect(fileExists("scripts/deploy.sh")).toBe(true);
    expect(fileExists("scripts/migrations-pending.sh")).toBe(true);
    expect(fileExists("scripts/live-test-plans.sh")).toBe(true);
  });

  it("scripts are executable", () => {
    const scripts = ["scripts/deploy.sh", "scripts/migrations-pending.sh", "scripts/live-test-plans.sh"];
    for (const script of scripts) {
      const path = new URL(script, `file://${root}/`).pathname;
      const stat = execSync(`stat -c '%a' "${path}"`, { encoding: "utf8" }).trim();
      expect(Number(stat.slice(-1))).toBeGreaterThanOrEqual(1);
    }
  });
});
