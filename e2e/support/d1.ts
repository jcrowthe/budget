import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

/** Sets a payee hidden straight in the e2e server's local D1 (hiding payees is EXF-510). */
export function hidePayee(id: string): void {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("not a payee id");
  // The server writes to the same file while other specs run: retry while SQLite reports it busy.
  for (let attempt = 0; ; attempt++) {
    try {
      run(id);
      return;
    } catch (e) {
      if (attempt >= 8 || !String((e as Error).message).includes("SQLITE_BUSY")) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1));
    }
  }
}

function run(id: string): void {
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@budget/worker",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "budget-db",
      "--local",
      "-c",
      path.join(root, "apps/worker/wrangler.jsonc"),
      "--persist-to",
      path.join(root, ".e2e-state"),
      "--command",
      `UPDATE payees SET hidden = 1 WHERE id = '${id}'`,
    ],
    { cwd: root, stdio: "pipe" },
  );
}
