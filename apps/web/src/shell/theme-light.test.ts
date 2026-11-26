import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every custom property that holds a colour (a literal, in any stylesheet) has a light value in theme-light.css,
// so a new token cannot leave the light theme with a dark-only colour.
const SRC = join(__dirname, "..");
const THEME_INDEPENDENT = /^--(preview|bankLogoFallback)/;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const declared = (css: string) =>
  [...stripComments(css).matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)].map(
    (m) => [m[1] as string, m[2] as string] as const,
  );

describe("theme-light.css", () => {
  const light = new Set(
    declared(readFileSync(join(SRC, "shell/theme-light.css"), "utf8")).map(([n]) => n),
  );

  it("defines every colour token", () => {
    const missing: string[] = [];
    for (const f of cssFiles(SRC)) {
      if (f.endsWith("theme-light.css")) continue;
      for (const [name, value] of declared(readFileSync(f, "utf8"))) {
        if (COLOUR.test(value) && !THEME_INDEPENDENT.test(name) && !light.has(name)) {
          missing.push(`${name} (${relative(SRC, f)})`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("sets the light colour-scheme", () => {
    expect(light.has("--colorScheme")).toBe(true);
  });
});
