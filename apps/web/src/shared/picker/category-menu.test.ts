import type { MonthGroupDetail } from "@budget/schema/months";
import { describe, expect, it } from "vitest";
import { categoryListMenu } from "./category-menu";

const cat = (id: string, name: string, available: number) => ({ id, name, available }) as never;
const groups = [
  { id: "g1", name: "Bills", categories: [cat("c1", "Rent", 100), cat("c2", "Power", 0)] },
  { id: "g2", name: "Fun Stuff", categories: [cat("c3", "Games", -5)] },
] as unknown as MonthGroupDetail[];

const names = (m: ReturnType<typeof categoryListMenu>) => m.flat.map((r) => r.name);

describe("categoryListMenu", () => {
  it("lists Inflow first with Ready to Assign when asked", () => {
    const m = categoryListMenu(groups, 50, "");
    expect(m.groups.map((g) => g.name)).toEqual(["Inflow", "Bills", "Fun Stuff"]);
    expect(names(m)).toEqual(["Ready to Assign", "Rent", "Power", "Games"]);
    expect(m.flat[0]?.amount).toBe(50);
  });

  it("leaves Inflow out when Ready to Assign is not offered", () => {
    const m = categoryListMenu(groups, undefined, "");
    expect(m.groups.map((g) => g.name)).toEqual(["Bills", "Fun Stuff"]);
    expect(names(m)).toEqual(["Rent", "Power", "Games"]);
  });

  it("a group name keeps the whole group; a category name keeps the row", () => {
    expect(names(categoryListMenu(groups, undefined, "BILL"))).toEqual(["Rent", "Power"]);
    expect(names(categoryListMenu(groups, undefined, "gam"))).toEqual(["Games"]);
  });

  it("'inflow' finds Ready to Assign only when it is asked for", () => {
    expect(names(categoryListMenu(groups, 0, "inflow"))).toEqual(["Ready to Assign"]);
    expect(categoryListMenu(groups, undefined, "inflow").empty).toBe(true);
  });

  it("no match is empty", () => {
    const m = categoryListMenu(groups, 0, "zzzz");
    expect(m.empty).toBe(true);
    expect(m.flat).toEqual([]);
  });
});
