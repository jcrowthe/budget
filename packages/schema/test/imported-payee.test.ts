import { describe, expect, it } from "vitest";
import { type ImportPayee, resolveImportedPayee, titleCaseAllCaps } from "../src/imported-payee";
import type { MatchableRule } from "../src/rename-rules";

const payees: ImportPayee[] = [
  { id: "p-phone", name: "D7 Phone Co", system: null },
  { id: "p-shop", name: "D7 Shop", system: null },
  { id: "p-gym", name: "D7 Gym", system: null },
];
const rules: MatchableRule[] = [
  {
    id: "r-contains",
    payeeId: "p-phone",
    kind: "contains",
    matchText: "phoneco",
    createdAt: "2026-11-01",
  },
  {
    id: "r-is",
    payeeId: "p-phone",
    kind: "is",
    matchText: "d7 phone company llc",
    createdAt: "2026-11-02",
  },
  {
    id: "r-paper",
    payeeId: "p-shop",
    kind: "contains",
    matchText: "paperco",
    createdAt: "2026-11-03",
  },
];

describe("resolveImportedPayee", () => {
  it.each([
    ["d7 phone company llc", { payee_id: "p-phone", rule_id: "r-is" }],
    ["D7 PHONE COMPANY LLC #2", { new_name: "D7 Phone Company Llc #2" }],
    ["D7 PAPERCO STORE", { payee_id: "p-shop", rule_id: "r-paper" }],
    ["D7 phoneco lower", { payee_id: "p-phone", rule_id: "r-contains" }],
    ["D7 Gym", { payee_id: "p-gym" }],
    ["D7 Brand New Vendor", { new_name: "D7 Brand New Vendor" }],
  ])("EXF-518 table: %s", (text, expected) => {
    expect(resolveImportedPayee(text, rules, payees)).toEqual(expected);
  });

  it("EXF-518 AC2: is needs the whole text, contains matches anywhere, both ignore case", () => {
    // `is`: the whole (folded) text.
    expect(resolveImportedPayee("D7 PHONE COMPANY LLC", rules, payees)).toEqual({
      payee_id: "p-phone",
      rule_id: "r-is",
    });
    expect(resolveImportedPayee("d7 phone company llc extra", rules, payees)).toEqual({
      new_name: "d7 phone company llc extra",
    });
    expect(resolveImportedPayee("x d7 phone company llc", rules, payees)).toEqual({
      new_name: "x d7 phone company llc",
    });
    // `contains`: anywhere, any case.
    expect(resolveImportedPayee("xx PaperCo yy", rules, payees)).toEqual({
      payee_id: "p-shop",
      rule_id: "r-paper",
    });
    expect(resolveImportedPayee("PAPERCO", rules, payees)).toEqual({
      payee_id: "p-shop",
      rule_id: "r-paper",
    });
  });

  it("EXF-518 AC3: an unmatched ALL-CAPS name becomes a title-cased new payee", () => {
    expect(resolveImportedPayee("ZZ SAMPLE CAFE", [], payees)).toEqual({
      new_name: "Zz Sample Cafe",
    });
    expect(resolveImportedPayee("D7 PHONE COMPANY LLC #2", [], [])).toEqual({
      new_name: "D7 Phone Company Llc #2",
    });
  });

  it("empty text is no payee", () => {
    expect(resolveImportedPayee("", rules, payees)).toBeNull();
    expect(resolveImportedPayee("   ", rules, payees)).toBeNull();
    expect(resolveImportedPayee(null, rules, payees)).toBeNull();
  });

  it("a rule whose payee is deleted or a system payee is ignored", () => {
    const ps: ImportPayee[] = [
      { id: "p-phone", name: "D7 Phone Co", system: null, deletedAt: "2026-11-05T00:00:00Z" },
      { id: "p-shop", name: "D7 Shop", system: "transfer" },
      { id: "p-gym", name: "D7 Gym", system: null },
    ];
    expect(resolveImportedPayee("d7 phone company llc", rules, ps)).toEqual({
      new_name: "d7 phone company llc",
    });
    expect(resolveImportedPayee("D7 PAPERCO STORE", rules, ps)).toEqual({
      new_name: "D7 Paperco Store",
    });
    // A stale rule never hides a live one.
    const live: MatchableRule = {
      id: "r-live",
      payeeId: "p-gym",
      kind: "contains",
      matchText: "phoneco",
      createdAt: "2026-10-01",
    };
    expect(resolveImportedPayee("D7 phoneco", [...rules, live], ps)).toEqual({
      payee_id: "p-gym",
      rule_id: "r-live",
    });
  });

  it("a hidden payee still matches", () => {
    // Hidden payees are ordinary rows: `ImportPayee` carries no hidden flag, so none is filtered.
    const ps: ImportPayee[] = [{ id: "p-h", name: "Hidden One", system: null }];
    expect(resolveImportedPayee("hidden one", [], ps)).toEqual({ payee_id: "p-h" });
  });

  it("an existing payee matches by folded name", () => {
    expect(resolveImportedPayee("  d7   GYM ", [], payees)).toEqual({ payee_id: "p-gym" });
  });

  it("new names are trimmed and cut to 200 characters", () => {
    expect(resolveImportedPayee("  Sample Cafe  ", [], [])).toEqual({ new_name: "Sample Cafe" });
    const r = resolveImportedPayee("a".repeat(300), [], []);
    expect(r && "new_name" in r ? r.new_name : "").toHaveLength(200);
  });

  it("titleCaseAllCaps leaves mixed case and letterless text alone", () => {
    expect(titleCaseAllCaps("Sample Cafe")).toBe("Sample Cafe");
    expect(titleCaseAllCaps("#123")).toBe("#123");
    expect(titleCaseAllCaps("7-ELEVEN")).toBe("7-Eleven");
  });
});
