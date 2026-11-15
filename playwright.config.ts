import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    storageState: ".e2e-state/auth.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bash scripts/e2e-serve.sh",
    // A 403 counts as up: the server is serving, and refusing the unsigned probe.
    url: "http://localhost:4173/api/v1/health",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
