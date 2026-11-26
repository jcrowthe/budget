import { randomBytes } from "node:crypto";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** The month after this one, 15th, noon UTC: always a month the fixed-month fixtures (2026-11) are not in. */
export function clockAheadDate(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15, 12)).toISOString();
}

/** The worker project; with `clock` every test file runs with `Date` moved there (test/setup.ts, EXF-977). */
export function workerProject(name: string, clock = "") {
  return defineConfig({
    plugins: [
      cloudflareTest(async () => ({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
            ENVIRONMENT: "local",
            LOCAL_JWT_SECRET: randomBytes(32).toString("base64"),
            SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            ACCESS_AUD: "test-aud",
            DEPLOY_SHA: "test",
            // Clock-ahead guard: see test/setup.ts.
            WORKER_CLOCK: clock,
          },
        },
      })),
    ],
    test: { name, include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
  });
}

export default workerProject("worker");
