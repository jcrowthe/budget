import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["packages/*/test/**/*.test.ts"] } },
      {
        test: {
          name: "scripts",
          include: ["scripts/test/**/*.test.ts"],
          testTimeout: 60_000,
        },
      },
      { test: { name: "web", include: ["apps/web/src/**/*.test.{ts,tsx}"] } },
      "apps/worker/vitest.config.ts",
    ],
  },
});
