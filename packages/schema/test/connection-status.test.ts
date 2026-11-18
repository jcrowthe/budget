import { describe, expect, it } from "vitest";
import {
  BROKEN_TEXT,
  DELAY_LINE,
  delayedOverThreeDays,
  lastCheckedText,
  POPUP_DELAYED_DETAILS,
  POPUP_REPAIR_DETAILS,
  placeStatusPopup,
  popupFor,
  REPAIR_STRIP,
  stripFor,
} from "../src/connection-status";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;
const acct = (over: Record<string, unknown> = {}) => ({
  linked: true,
  closed: false,
  connection_status: "connected" as const,
  last_synced_at: ago(H) as string | null,
  ...over,
});

describe("stripFor", () => {
  it("shows nothing for connected, unlinked and closed accounts", () => {
    expect(stripFor(acct(), undefined, NOW)).toBeNull();
    expect(stripFor(acct({ linked: false, connection_status: null }), undefined, NOW)).toBeNull();
    expect(
      stripFor(acct({ closed: true, connection_status: "login_required" }), undefined, NOW),
    ).toBeNull();
  });
  it("asks for Repair on login_required", () => {
    expect(stripFor(acct({ connection_status: "login_required" }), undefined, NOW)).toEqual({
      kind: "repair",
      text: REPAIR_STRIP,
    });
  });
  it("says broken for broken and for a linked account of unknown status", () => {
    const want = { kind: "broken", text: BROKEN_TEXT };
    expect(stripFor(acct({ connection_status: "broken" }), undefined, NOW)).toEqual(want);
    expect(stripFor(acct({ connection_status: null }), undefined, NOW)).toEqual(want);
  });
  it("has no strip for a delay of up to three days, a line after", () => {
    const d = (ms: number) => acct({ connection_status: "delayed", last_synced_at: ago(ms) });
    expect(stripFor(d(2 * 24 * H), undefined, NOW)).toBeNull();
    expect(stripFor(d(72 * H), undefined, NOW)).toBeNull();
    expect(stripFor(d(72 * H - 1), undefined, NOW)).toBeNull();
    expect(stripFor(d(72 * H + 1), undefined, NOW)).toEqual({ kind: "delayed", text: DELAY_LINE });
    expect(stripFor(d(4 * 24 * H), undefined, NOW)?.kind).toBe("delayed");
  });
  it("counts a never-synced delay from the connection's creation", () => {
    const a = acct({ connection_status: "delayed", last_synced_at: null });
    expect(stripFor(a, undefined, NOW)).toBeNull();
    expect(stripFor(a, ago(2 * 24 * H), NOW)).toBeNull();
    expect(stripFor(a, ago(4 * 24 * H), NOW)?.kind).toBe("delayed");
  });
});

describe("delayedOverThreeDays", () => {
  it("treats an unreadable time as no line", () => {
    expect(delayedOverThreeDays("not a time", undefined, NOW)).toBe(false);
    expect(delayedOverThreeDays(null, "nope", NOW)).toBe(false);
  });
});

describe("lastCheckedText and popupFor", () => {
  it("words the last check", () => {
    expect(lastCheckedText(null, NOW)).toBe("Not checked yet");
    expect(lastCheckedText(ago(H), NOW)).toBe("Last checked an hour ago");
    expect(lastCheckedText(ago(3 * 24 * H), NOW)).toBe("Last checked 3 days ago");
  });
  it("gives each status its title, line, details and action", () => {
    expect(popupFor("connected", ago(H), NOW)).toEqual({
      title: "Connected",
      line: "Last checked an hour ago",
      details: null,
      action: null,
    });
    expect(popupFor("login_required", ago(H), NOW)).toEqual({
      title: "Connection Repair Needed",
      line: "Last attempted an hour ago",
      details: POPUP_REPAIR_DETAILS,
      action: "repair",
    });
    expect(popupFor("delayed", null, NOW)).toEqual({
      title: "Imports Delayed",
      line: "Not checked yet",
      details: POPUP_DELAYED_DETAILS,
      action: null,
    });
    expect(popupFor("broken", ago(H), NOW).details).toBe(BROKEN_TEXT);
  });
});

describe("placeStatusPopup", () => {
  const size = { width: 292, height: 160 };
  const mark = { left: 200, top: 300, right: 220, bottom: 320 };
  // The source's arrow is 30x15 (1.875rem x 0.9375rem) (measured by the Designer in the test plan's style rules).
  it("sits 15 px right of the mark (the arrow's depth), centred, at 1440x900 and 1024x700", () => {
    const want = { left: 235, top: 230, side: "right", arrowTop: 65 };
    expect(placeStatusPopup(mark, size, 1440, 900)).toEqual(want);
    expect(placeStatusPopup(mark, size, 1024, 700)).toEqual(want);
  });
  it("is kept inside the window near the bottom and the top", () => {
    const low = { left: 200, top: 690, right: 220, bottom: 700 };
    expect(placeStatusPopup(low, size, 1024, 700).top).toBe(700 - 8 - 160);
    const high = { left: 200, top: 0, right: 220, bottom: 10 };
    expect(placeStatusPopup(high, size, 1024, 700).top).toBe(8);
  });
  it("goes left of the mark when there is no room on the right", () => {
    const right = { left: 900, top: 300, right: 920, bottom: 320 };
    const p = placeStatusPopup(right, size, 1024, 700);
    expect(p.left).toBe(900 - 15 - 292);
    expect(p.side).toBe("left");
  });
});
