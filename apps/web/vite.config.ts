import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localAccess } from "./dev/local-access";

const repoRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  plugins: [
    react(),
    localAccess(),
    cloudflare({
      configPath: "../worker/wrangler.jsonc",
      persistState: {
        path: process.env.BUDGET_STATE_DIR ?? path.join(repoRoot, ".wrangler/state"),
      },
    }),
  ],
  preview: { port: 4173, strictPort: true },
});
