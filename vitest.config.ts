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
      "apps/worker/vitest.config.ts",
    ],
  },
});
