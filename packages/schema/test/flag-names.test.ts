import { describe, expect, it } from "vitest";
import { Budget, BudgetUpdate } from "../src/budgets";
import { DEFAULT_FLAG_NAMES, flagColorByName, flagLabelOf } from "../src/transactions";

describe("flagLabelOf", () => {
  it("gives the custom name, else the colour name", () => {
    const label = flagLabelOf({ red: "Tax", blue: null });
    expect(label("red")).toBe("Tax");
    expect(label("blue")).toBe("Blue");
    expect(label("green")).toBe("Green");
  });
  it("falls back to colour names for null or undefined names", () => {
    expect(flagLabelOf(null)("purple")).toBe("Purple");
    expect(flagLabelOf(undefined)("orange")).toBe("Orange");
    expect(flagLabelOf(DEFAULT_FLAG_NAMES)("yellow")).toBe("Yellow");
  });
});

describe("flagColorByName", () => {
  it("matches a custom name, case-insensitively", () => {
    expect(flagColorByName("tax", { red: "Tax" })).toBe("red");
    expect(flagColorByName("TAX", { red: "Tax" })).toBe("red");
  });
  it("duplicates resolve to the first colour", () => {
    expect(flagColorByName("Bills", { green: "Bills", orange: "Bills" })).toBe("orange");
  });
  it("a custom name wins over a default colour name: Red named Blue is red", () => {
    expect(flagColorByName("Blue", { red: "Blue" })).toBe("red");
  });
  it("default names still match, and nothing gives undefined", () => {
    expect(flagColorByName("Blue", { red: "Tax" })).toBe("blue");
    expect(flagColorByName("red", null)).toBe("red");
    expect(flagColorByName("nope", { red: "Tax" })).toBeUndefined();
  });
});

describe("Budget and BudgetUpdate flag_names", () => {
  it("Budget defaults to all null", () => {
    const b = Budget.parse({
      id: crypto.randomUUID(),
      name: "ZZ-TEST",
      created_at: "x",
      last_modified_on: "x",
      last_opened_at: null,
      bank_environment: "production",
    });
    expect(b.flag_names).toEqual(DEFAULT_FLAG_NAMES);
  });
  it("BudgetUpdate accepts a partial object or null, and refuses an unknown colour", () => {
    expect(BudgetUpdate.safeParse({ flag_names: { red: "Tax", blue: null } }).success).toBe(true);
    expect(BudgetUpdate.safeParse({ flag_names: null }).success).toBe(true);
    expect(BudgetUpdate.safeParse({ flag_names: { pink: "x" } }).success).toBe(false);
  });
});
