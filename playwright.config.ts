import { defineConfig, devices } from "@playwright/test";
import { suiteWorkers } from "./e2e/support/e2e-load-workers";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: suiteWorkers(),
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
