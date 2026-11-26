import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cycleTheme, resolveTheme, THEME_ORDER, type ThemeChoice } from "./theme";

describe("resolveTheme", () => {
  it("maps the three choices", () => {
    expect(resolveTheme("default", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("match_system", true)).toBe("dark");
    expect(resolveTheme("match_system", false)).toBe("light");
  });
});

describe("cycleTheme", () => {
  it("steps and wraps around", () => {
    expect(THEME_ORDER).toEqual(["default", "dark", "match_system"]);
    expect(cycleTheme("dark", 1)).toBe("match_system");
    expect(cycleTheme("match_system", 1)).toBe("default");
    expect(cycleTheme("default", -1)).toBe("match_system");
    expect(cycleTheme("dark", -1)).toBe("default");
  });
});

// The inline script of index.html and resolveTheme must agree, so run the real script.
describe("the first-paint script in index.html", () => {
  const page = readFileSync(join(__dirname, "../../index.html"), "utf8");
  const code = /<script id="theme-first-paint">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? "";

  function run(stored: string | null | "throw", prefersDark: boolean) {
    const classes: string[] = [];
    const localStorage = {
      getItem: () => {
        if (stored === "throw") throw new Error("denied");
        return stored;
      },
    };
    const document = { documentElement: { classList: { add: (c: string) => classes.push(c) } } };
    const matchMedia = () => ({ matches: prefersDark });
    new Function("localStorage", "matchMedia", "document", code)(
      localStorage,
      matchMedia,
      document,
    );
    return classes;
  }

  it("is there", () => expect(code).not.toBe(""));

  it.each<[string | null, boolean]>([
    ["default", true],
    ["default", false],
    ["dark", true],
    ["dark", false],
    ["match_system", true],
    ["match_system", false],
    [null, true],
    [null, false],
    ["light", false],
    ["", true],
    ["{}", false],
  ])("stored %j, OS dark %j", (stored, prefersDark) => {
    const known = ["default", "dark", "match_system"].includes(stored ?? "");
    const choice: ThemeChoice = known ? (stored as ThemeChoice) : "dark";
    expect(run(stored, prefersDark)).toEqual([`theme-${resolveTheme(choice, prefersDark)}`]);
  });

  it("falls back to dark when storage throws", () => {
    expect(run("throw", false)).toEqual(["theme-dark"]);
  });
});
