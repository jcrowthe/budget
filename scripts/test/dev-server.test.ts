import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

// Vitest sets NODE_ENV=test and VITEST*; vite and the Worker plugin must not inherit them.
function devEnv(state: string) {
  const env: Record<string, string | undefined> = { ...process.env, BUDGET_STATE_DIR: state };
  for (const k of Object.keys(env)) if (k.startsWith("VITEST")) delete env[k];
  env.NODE_ENV = "development";
  return env;
}

let lastErr = "";
let proc: ChildProcess;
let base = "";
let state = "";

// Design doc §7 case 2. Runs the same vite dev command as `pnpm dev`, on a free port with its own
// state dir, so it never touches a developer's running server.
describe("dev server", () => {
  beforeAll(async () => {
    state = mkdtempSync(join(tmpdir(), "budget-dev-"));
    const run = (cmd: string, args: string[]) =>
      new Promise<void>((resolve, reject) =>
        spawn(cmd, args, { cwd: root, stdio: "ignore" }).on("exit", (c) =>
          c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${c}`)),
        ),
      );
    await run("node", ["scripts/dev-vars.mjs"]);
    await run("bash", ["scripts/db-migrate-local.sh", state]);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    proc = spawn(
      "pnpm",
      [
        "--filter",
        "@budget/web",
        "exec",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      {
        cwd: root,
        stdio: "ignore",
        detached: true,
        env: devEnv(state),
      },
    );
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        const r = await fetch(`${base}/api/v1/health`);
        lastErr = `status ${r.status}`;
        if (r.status === 200) break;
      } catch (e) {
        lastErr = `${e} ${(e as Error).cause}`;
      }
      if (Date.now() > deadline) throw new Error(`dev server did not start: ${lastErr}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 180_000);

  afterAll(() => {
    if (proc?.pid) {
      try {
        process.kill(-proc.pid);
      } catch (e) {
        lastErr = `${e} ${(e as Error).cause}`;
      }
    }
    rmSync(state, { recursive: true, force: true });
  });

  it("answers health with 200 and the local deploy sha, signed in", async () => {
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", deploy_sha: "local" });
  });

  it("serves the SPA HTML at /", async () => {
    const res = await fetch(`${base}/`, { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});
