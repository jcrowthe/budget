import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every colour comes from a token (shell/tokens.css; the light set is shell/theme-light.css), so a theme only
// has to define tokens. register/** and plan/panel/** belong to other units: their literals are listed in
// docs/display-options-design.md instead.
const SRC = join(__dirname, "..");
const EXEMPT = [
  join("shell", "tokens.css"),
  join("shell", "theme-light.css"),
  "register/",
  "plan/panel/",
];
const NAMED =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgrey|darkgreen|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|grey|green|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgrey|lightgreen|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
const RAW = new RegExp(
  `#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\(|(?<![\\w-])(?:${NAMED})(?![\\w-])`,
  "i",
);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}

/** The lines of a stylesheet outside comments, with url(...) and quoted strings blanked. */
function codeLines(css: string): [number, string][] {
  const blank = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return blank
    .split("\n")
    .map((l, i): [number, string] => [
      i + 1,
      l.replace(/url\([^)]*\)/g, "url()").replace(/"[^"]*"|'[^']*'/g, '""'),
    ]);
}

describe("no raw colours outside the token files", () => {
  it("every colour in a stylesheet is a var(--token)", () => {
    const bad: string[] = [];
    for (const f of cssFiles(SRC)) {
      const rel = relative(SRC, f);
      if (EXEMPT.some((e) => rel === e || rel.startsWith(e))) continue;
      for (const [n, line] of codeLines(readFileSync(f, "utf8"))) {
        const decl = line.split(":").slice(1).join(":");
        if (RAW.test(decl)) bad.push(`${rel}:${n}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
