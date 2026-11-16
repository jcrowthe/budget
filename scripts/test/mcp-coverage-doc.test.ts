import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;
const doc = readFileSync(`${root}docs/mcp-coverage-design.md`, "utf8");

// EXF-574 acceptance 12: the coverage design doc stays in step with main.
describe("docs/mcp-coverage-design.md", () => {
  it("states the sort exception in the 'carries money' rule", () => {
    expect(doc).toMatch(/`sort` is a display position, not\s+money/);
    expect(doc).toContain("NOT_MONEY");
  });

  it("names the category tools that are present", () => {
    for (const tool of [
      "create_category_group",
      "rename_category_group",
      "set_category_group_hidden",
      "delete_category_group",
      "get_category_group_usage",
      "create_category",
      "rename_category",
      "set_category_hidden",
      "delete_category",
      "unhide_all_categories",
      "get_category_usage",
    ]) {
      expect(doc, tool).toContain(`\`${tool}\``);
    }
  });

  it("no longer says category routes are not on main", () => {
    expect(doc).not.toMatch(/categor[^.\n]*(are|is) not (yet )?on main/i);
    expect(doc).not.toMatch(/not (yet )?(merged|on main)[^.\n]*categor/i);
    expect(doc).toMatch(/category[^.\n]*routes are on main/);
  });
});
