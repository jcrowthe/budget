import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

/** Sets a payee hidden straight in the e2e server's local D1 (hiding payees is EXF-510). */
export function hidePayee(id: string): void {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("not a payee id");
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
