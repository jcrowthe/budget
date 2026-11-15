import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;

function run(args: string[], env?: Record<string, string>) {
  return spawnSync("bash", ["scripts/live-test-plans.sh", ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      BASE_URL: "http://localhost:5173",
      ...env,
    },
    encoding: "utf8",
  });
}

describe("scripts/live-test-plans.sh", () => {
  it("delete_import returns not applicable message", () => {
    const r = run(["delete_import"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Not applicable yet: the app has no imports.");
  });

  it("routes returns route description", () => {
    const r = run(["routes"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("single-page app");
    expect(r.stdout).toContain("/api/v1/budgets");
    expect(r.stdout).toContain("/mcp");
  });

  it("refuses to create a plan without the test prefix", () => {
    const r = run(["create", "MyPlan"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("must start with ZZ-TEST");
  });

  it("refuses to list when BASE_URL is invalid", () => {
    const r = run(["list"], { BASE_URL: "http://invalid-host:9999" });
    expect(r.status).not.toBe(0);
  });

  it("requires command argument", () => {
    const r = run([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unknown command");
  });

  it("refuses unknown commands", () => {
    const r = run(["unknown"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unknown command");
  });

  it("delete requires an id argument", () => {
    const r = run(["delete"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("delete requires an id argument");
  });

  it("create requires a name argument", () => {
    const r = run(["create"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("create requires a name argument");
  });
});
