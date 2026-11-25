import { describe, expect, it } from "vitest";
import { type DragItem, type SidebarRow, sidebarPlacement } from "./sidebarDnd";

const rect = { top: 100, height: 32 };
const TOP = 102;
const BOTTOM = 130;
const cash: SidebarRow[] = ["a", "b", "c"].map((id) => ({ id, group: "cash" }));
const item = (id: string, section: DragItem["section"] = "cash"): DragItem => ({
  id,
  section,
  group: "cash",
});
const row = (id: string, rows = cash) => rows.find((r) => r.id === id) as SidebarRow;

describe("sidebarPlacement", () => {
  it("top half: before the target", () => {
    expect(sidebarPlacement(item("c"), "cash", cash, row("a"), TOP, rect)).toEqual({
      ids: ["c", "a", "b"],
      gap: { before: "a" },
    });
  });

  it("bottom half: after the target", () => {
    expect(sidebarPlacement(item("a"), "cash", cash, row("b"), BOTTOM, rect)).toEqual({
      ids: ["b", "a", "c"],
      gap: { after: "b" },
    });
  });

  it("is null on itself and where the order would not change", () => {
    expect(sidebarPlacement(item("b"), "cash", cash, row("b"), TOP, rect)).toBeNull();
    expect(sidebarPlacement(item("a"), "cash", cash, row("b"), TOP, rect)).toBeNull();
    expect(sidebarPlacement(item("b"), "cash", cash, row("a"), BOTTOM, rect)).toBeNull();
  });

  it("is null in another section, and never in closed", () => {
    const tracking: SidebarRow[] = [{ id: "t", group: "tracking" }];
    expect(
      sidebarPlacement(item("a"), "tracking", tracking, row("t", tracking), TOP, rect),
    ).toBeNull();
    expect(sidebarPlacement(item("a", "closed"), "closed", cash, row("b"), TOP, rect)).toBeNull();
  });

  it("STARRED: only among the starred rows of the dragged account's group", () => {
    const starred: SidebarRow[] = [
      { id: "a", group: "cash" },
      { id: "x", group: "credit" },
      { id: "c", group: "cash" },
    ];
    expect(
      sidebarPlacement(item("c", "starred"), "starred", starred, row("a", starred), TOP, rect),
    ).toEqual({ ids: ["c", "a"], gap: { before: "a" } });
    expect(
      sidebarPlacement(item("c", "starred"), "starred", starred, row("x", starred), TOP, rect),
    ).toBeNull();
  });
});
