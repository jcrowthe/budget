import { describe, expect, it } from "vitest";
import {
  checkRuleText,
  foldRuleText,
  type MatchableRule,
  pickRenameRule,
} from "../src/rename-rules";

let n = 0;
const rule = (
  payeeId: string,
  kind: "is" | "contains",
  text: string,
  createdAt = "2026-01-01T00:00:00.000Z",
  id = `r${++n}`,
): MatchableRule => ({ id, payeeId, kind, matchText: foldRuleText(text), createdAt });

describe("foldRuleText", () => {
  it("ignores case, runs of white space and composition", () => {
    expect(foldRuleText("  ZZ   Cafe ")).toBe("zz cafe");
    expect(foldRuleText("CAFÉ")).toBe(foldRuleText("café"));
    expect(foldRuleText("Café")).toBe(foldRuleText("Café"));
  });
  it("is lower case, not full case folding", () => {
    expect(foldRuleText("STRASSE")).not.toBe(foldRuleText("straße"));
  });
});

describe("pickRenameRule", () => {
  it("is matches the whole name only", () => {
    const r = [rule("a", "is", "zz bank cafe")];
    expect(pickRenameRule("ZZ BANK CAFE", r)?.payeeId).toBe("a");
    expect(pickRenameRule("ZZ BANK CAFE 12", r)).toBeNull();
  });
  it("contains needs the words in order and has no wildcards", () => {
    expect(pickRenameRule("EATS UBER", [rule("a", "contains", "uber eats")])).toBeNull();
    expect(pickRenameRule("UBER EATS ORDER", [rule("a", "contains", "uber eats")])?.payeeId).toBe(
      "a",
    );
    expect(pickRenameRule("UBER TRIP", [rule("a", "contains", "ub*r")])).toBeNull();
    expect(pickRenameRule("UB*R TRIP", [rule("a", "contains", "ub*r")])?.payeeId).toBe("a");
  });
  it("any rule of a payee matches", () => {
    const r = [rule("a", "is", "x"), rule("a", "contains", "uber")];
    expect(pickRenameRule("Uber Trip", r)?.payeeId).toBe("a");
  });
  it("is beats a newer contains; among one kind the newest wins, then the greater id", () => {
    const old = "2026-01-01T00:00:00.000Z";
    const recent = "2026-02-01T00:00:00.000Z";
    expect(
      pickRenameRule("zz shop", [
        rule("a", "is", "zz shop", old),
        rule("b", "contains", "zz", recent),
      ])?.payeeId,
    ).toBe("a");
    expect(
      pickRenameRule("zz shop", [
        rule("a", "contains", "zz", old),
        rule("b", "contains", "shop", recent),
      ])?.payeeId,
    ).toBe("b");
    expect(
      pickRenameRule("zz shop", [
        rule("a", "contains", "zz", old, "1"),
        rule("b", "contains", "shop", old, "2"),
      ])?.payeeId,
    ).toBe("b");
  });
  it("matches non-ASCII and null names", () => {
    expect(pickRenameRule("CAFÉ ZZ", [rule("a", "contains", "café")])?.payeeId).toBe("a");
    expect(pickRenameRule(null, [rule("a", "contains", "x")])).toBeNull();
  });
});

describe("checkRuleText", () => {
  it("trims and bounds", () => {
    expect(checkRuleText("  ")).toEqual({ ok: false, error: "empty" });
    expect(checkRuleText("a".repeat(201))).toEqual({ ok: false, error: "tooLong" });
    expect(checkRuleText("a".repeat(200)).ok).toBe(true);
    expect(checkRuleText("  x ")).toEqual({ ok: true, text: "x" });
  });
});
