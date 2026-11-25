import { describe, expect, it } from "vitest";
import {
  actorName,
  dayGroups,
  entryText,
  matchesType,
  RECENT_MOVES_DAYS,
  type RecentMove,
} from "../src/recent-moves";

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
  amount: 1000,
  from: null,
  to: side("a"),
  method: "edit",
  from_move: false,
  undo_of: null,
  ...over,
});
const money = (n: number) => `$${(n / 1000).toFixed(2)}`;

describe("recent moves: window", () => {
  it("is 34 days", () => expect(RECENT_MOVES_DAYS).toBe(34));
});

describe("matchesType", () => {
  const moved = entry({
    kind: "moved",
    from: side("a"),
    to: side("b"),
    method: "move",
    from_move: true,
  });
  const toRta = entry({
    kind: "removed",
    from: side("a"),
    to: null,
    method: "move",
    from_move: true,
  });
  const fromRta = entry({ kind: "assigned", method: "move", from_move: true });
  const edit = entry({});
  const editDown = entry({ kind: "removed", from: side("a"), to: null });
  const all = [moved, toRta, fromRta, edit, editDown];

  it("puts category moves in Moved and everything else in Assigned", () => {
    expect(all.filter((e) => matchesType(e, "moved"))).toEqual([moved, toRta]);
    expect(all.filter((e) => matchesType(e, "assigned"))).toEqual([fromRta, edit, editDown]);
  });
  it("lists every entry under All, in exactly one of the other two", () => {
    for (const e of all) {
      expect(matchesType(e, "all")).toBe(true);
      expect(matchesType(e, "moved")).not.toBe(matchesType(e, "assigned"));
    }
  });
});

describe("actorName", () => {
  it("uses the email's local part for users and MCP users", () => {
    expect(actorName("user:jo.doe@example.com")).toEqual({ name: "jo.doe", initial: "J" });
    expect(actorName("mcp:user:ann@example.com")).toEqual({ name: "ann", initial: "A" });
  });
  it("uses the service name, and the text for anything else", () => {
    expect(actorName("service:plaid")).toEqual({ name: "plaid", initial: "P" });
    expect(actorName("mcp:service:bot")).toEqual({ name: "bot", initial: "B" });
    expect(actorName("system")).toEqual({ name: "system", initial: "S" });
  });
});

describe("dayGroups", () => {
  it("groups newest first by local day and marks today", () => {
    const now = new Date(2026, 10, 15, 12, 0, 0);
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).toISOString();
    const e1 = entry({ id: "1", at: at(15, 9) });
    const e2 = entry({ id: "2", at: at(15, 8) });
    const e3 = entry({ id: "3", at: at(12, 23) });
    const g = dayGroups([e1, e2, e3], now);
    expect(g.map((x) => [x.label, x.today, x.entries.map((e) => e.id)])).toEqual([
      ["Nov 15, 2026", true, ["1", "2"]],
      ["Nov 12, 2026", false, ["3"]],
    ]);
  });
  it("is empty for no entries", () => expect(dayGroups([], new Date())).toEqual([]));
});

describe("entryText", () => {
  it("words each kind", () => {
    expect(entryText(entry({}), money)).toEqual({ lead: "assigned $1.00 to", between: null });
    expect(
      entryText(entry({ kind: "removed", from: side("a"), to: null, amount: 50000 }), money),
    ).toEqual({ lead: "removed $50.00 from", between: null });
    expect(
      entryText(entry({ kind: "moved", from: side("a"), to: side("b"), amount: 25000 }), money),
    ).toEqual({ lead: "moved $25.00 from", between: "to" });
  });
});
