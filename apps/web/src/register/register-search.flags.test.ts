import { describe, expect, it } from "vitest";
import { type SearchCtx, suggestions } from "./register-search";

const base: SearchCtx = {
  dateFormat: "MM/DD/YYYY",
  today: "2026-11-26",
  money: (n) => String(n),
  date: (s) => s,
  parseDate: () => null,
};

describe("register search: flag suggestions use the plan's names (EXF-480)", () => {
  it("Flag: lists None and the plan's names in colour order", () => {
    const s = suggestions("flag", { ...base, flagNames: { red: "Tax", blue: "Bills" } }, [], []);
    expect(s.filter((x) => x.label === "Flag:").map((x) => x.description)).toEqual([
      "None",
      "Tax",
      "Orange",
      "Yellow",
      "Green",
      "Bills",
      "Purple",
    ]);
  });
  it("without custom names it lists the colour names", () => {
    const s = suggestions("flag", base, [], []);
    expect(s.filter((x) => x.label === "Flag:").map((x) => x.write)).toContain("Flag: Red");
  });
  it("a word of a custom name finds it", () => {
    const s = suggestions("tax", { ...base, flagNames: { red: "Tax" } }, [], []);
    expect(s.map((x) => x.write)).toContain("Flag: Tax");
  });
});
