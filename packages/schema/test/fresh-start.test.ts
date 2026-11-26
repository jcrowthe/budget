import { describe, expect, it } from "vitest";
import { archivedPlanName, PLAN_NAME_TAKEN, planNameKey, planNameTaken } from "../src/fresh-start";

describe("Fresh Start plan-name helpers (EXF-478)", () => {
  it("the clash key ignores case and surrounding spaces", () => {
    expect(planNameKey(" Home ")).toBe(planNameKey("home"));
    expect(planNameTaken(["Home", "Other"], "home ")).toBe(true);
    expect(planNameTaken(["Home", "Other"], "Homes")).toBe(false);
    expect(PLAN_NAME_TAKEN).toBe("The plan name already exists.");
  });

  it("the archive name carries the date", () => {
    expect(archivedPlanName("A", "2026-11-26")).toBe("A (Archived on 2026-11-26)");
  });

  it("a long name is cut so the result is 100 characters and ends with the suffix", () => {
    const name = `${"x".repeat(74)} ${"y".repeat(25)}`; // 100 characters; the cut falls after the space
    const out = archivedPlanName(name, "2026-11-26");
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(" (Archived on 2026-11-26)")).toBe(true);
    const ninetyNine = archivedPlanName("z".repeat(99), "2026-11-26");
    expect(ninetyNine.length).toBe(100);
    expect(ninetyNine).toBe(`${"z".repeat(75)} (Archived on 2026-11-26)`);
    // trailing spaces of the cut base are trimmed
    const spaced = archivedPlanName(`${"a".repeat(74)}${" ".repeat(25)}b`, "2026-11-26");
    expect(spaced).toBe(`${"a".repeat(74)} (Archived on 2026-11-26)`);
  });
});
