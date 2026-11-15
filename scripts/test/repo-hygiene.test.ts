import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;
const EXT = /\.(ts|tsx|css|html|svg)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

describe("repository hygiene", () => {
  // Design doc §7 case 13.
  it("has no YNAB branding outside the API-shape comment", () => {
    const hits: string[] = [];
    for (const dir of ["apps", "packages"]) {
      for (const file of walk(join(root, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/ynab|you need a budget/i.test(line)) {
              hits.push(`${relative(root, file)}:${i + 1}`);
            }
          });
      }
    }
    expect(hits).toEqual(["packages/schema/src/common/envelope.ts:3"]);
  });

  // Design doc §7 case 17.
  it("has no GitHub Actions workflows", () => {
    expect(existsSync(join(root, ".github/workflows"))).toBe(false);
  });

  // Profile-completion design doc, Acceptance case 15.
  describe("profile-completion scope", () => {
    const BASE = "2d82719";
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" });
    let hasBase = true;
    try {
      git("cat-file", "-e", `${BASE}^{commit}`);
    } catch {
      hasBase = false;
    }

    it.skipIf(!hasBase)("leaves apps and scripts/lib unchanged since the base", () => {
      expect(git("diff", BASE, "--", "apps", "scripts/lib")).toBe("");
    });

    it.skipIf(!hasBase)("changes no file outside the Manifest", () => {
      const allowed = [
        /^clone\.profile\.json$/,
        /^scripts\/deploy\.sh$/,
        /^scripts\/migrations-pending\.sh$/,
        /^scripts\/live-test-plans\.sh$/,
        /^scripts\/test\//,
        /^docs\/conventions\.md$/,
        /^docs\/profile-completion-design\.md$/,
        /^docs\/profile-completion-spec\.md$/,
        /^docs\/README\.md$/,
      ];
      const changed = git("diff", "--name-only", BASE).split("\n").filter(Boolean);
      expect(changed.filter((f) => !allowed.some((re) => re.test(f)))).toEqual([]);
    });
  });
});
