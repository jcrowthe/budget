import { randomBytes } from "node:crypto";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
        },
      },
    })),
  ],
  test: { name: "worker", include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});
