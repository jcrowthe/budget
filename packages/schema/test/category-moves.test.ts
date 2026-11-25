import { describe, expect, it } from "vitest";
import { categoryMoveRow, METHOD_LABEL, type RecentMove } from "../src/recent-moves";

const side = (id: string, name = id) => ({
  category_id: id,
  category_name: name,
  month: "2026-11-01",
  deleted: false,
});
const entry = (over: Partial<RecentMove>): RecentMove => ({
  id: "e",
  at: "2026-11-15T10:00:00.000Z",
  actor: { id: "user:z@x", name: "z", initial: "Z" },
  kind: "assigned",
  amount: 100000,
  from: null,
  to: side("rent", "Rent"),
  method: "edit",
  from_move: false,
  undo_of: null,
  ...over,
});
const money = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1000).toFixed(2)}`;
const row = (e: RecentMove, cid = "rent") => categoryMoveRow(e, cid, money);
const moved = (amount: number) =>
  entry({
    kind: "moved",
    amount,
    from_move: true,
    method: "move",
    from: side("rent", "Rent"),
    to: side("fun", "Fun"),
  });

describe("categoryMoveRow", () => {
  it("reads the four ticket rows", () => {
    expect(row(entry({}))).toMatchObject({ text: "Assigned", signed: "$100.00", amount: 100000 });
    expect(
      row(entry({ kind: "removed", amount: 150000, from: side("rent"), to: null })),
    ).toMatchObject({ text: "Removed", signed: "−$150.00", amount: -150000 });
    expect(row(moved(70000))).toMatchObject({ text: "Moved to Fun", signed: "−$70.00" });
    expect(row(moved(75000), "fun")).toMatchObject({ text: "Moved from Rent", signed: "$75.00" });
  });

  it("reads a move to or from Ready to Assign as Removed or Assigned", () => {
    const out = entry({
      kind: "removed",
      from_move: true,
      method: "move",
      from: side("rent"),
      to: null,
    });
    expect(row(out).text).toBe("Removed");
    const inn = entry({ kind: "assigned", from_move: true, method: "move", from: null });
    expect(row(inn).text).toBe("Assigned");
  });

  it("annotates cover, auto-assign, undo and redo", () => {
    expect(METHOD_LABEL).toEqual({
      cover: "Cover",
      auto_assign: "Auto-Assign",
      undo: "Undo",
      redo: "Redo",
    });
    expect(row(entry({ method: "redo" })).note).toBe("Redo");
    expect(row(entry({ method: "undo" })).note).toBe("Undo");
    expect(row(entry({})).note).toBeNull();
  });
});
