import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const docs = new URL("../../docs/", import.meta.url).pathname;

describe("docs/README.md", () => {
  it("links every other docs/*.md file as (<file>)", () => {
    const index = readFileSync(`${docs}README.md`, "utf8");
    const missing = readdirSync(docs)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .filter((f) => !index.includes(`(${f})`))
      .map((f) => `docs/${f}`);
    expect(
      missing,
      "Docs not indexed in docs/README.md. Add one line per file: - [Title](file.md): what it covers.",
    ).toEqual([]);
  });
});
