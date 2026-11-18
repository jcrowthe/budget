import { describe, expect, it } from "vitest";
import {
  popupFor,
  REAUTHORIZE_STRIP,
  RELINK_DETAILS,
  RELINK_STRIP,
  shownLabel,
  shownStatus,
  stripFor,
  UNAVAILABLE_TEXT,
  UNSUPPORTED_TEXT,
} from "../src/connection-status";
import { connectionBadge, statusLabel } from "../src/manage-connections";
import { type StatusReason, statusReason, storedErrorCode } from "../src/plaid-import";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("statusReason", () => {
  const rows: [string, string | null, StatusReason | null][] = [
    ["delayed", "INSTITUTION_NOT_AVAILABLE", "unavailable"],
    ["delayed", "INSTITUTION_NO_LONGER_SUPPORTED", "unsupported"],
    ["delayed", "INSTITUTION_DOWN", null],
    ["delayed", "INSTITUTION_NOT_RESPONDING", null],
    ["delayed", null, null],
    ["login_required", "INVALID_MFA", "reauthorize"],
    ["login_required", "INSUFFICIENT_CREDENTIALS", "reauthorize"],
    ["login_required", "PENDING_EXPIRATION", "reauthorize"],
    ["login_required", "PENDING_DISCONNECT", "reauthorize"],
    ["login_required", "ITEM_LOGIN_REQUIRED", null],
    ["login_required", null, null],
    ["broken", "INSTITUTION_NOT_AVAILABLE", null],
    ["connected", "PENDING_EXPIRATION", null],
    ["login_required", "INSTITUTION_NOT_AVAILABLE", null],
  ];
  it.each(rows)("%s + %s → %s", (status, code, reason) => {
    expect(statusReason(status, code)).toBe(reason);
  });
  it("stores only an identifier", () => {
    expect(storedErrorCode("ITEM_LOGIN_REQUIRED")).toBe("ITEM_LOGIN_REQUIRED");
    expect(storedErrorCode("a message")).toBeNull();
    expect(storedErrorCode(null)).toBeNull();
    expect(storedErrorCode("A".repeat(65))).toBeNull();
  });
});

describe("shownStatus", () => {
  const a = (
    connection_status: "connected" | "delayed" | "login_required" | "broken",
    connection_reason: StatusReason | null = null,
    link_missing_since: string | null = null,
  ) => ({ linked: true, connection_status, connection_reason, link_missing_since });
  it("is null when not linked", () => {
    expect(shownStatus({ linked: false, connection_status: null })).toBeNull();
  });
  it("shows a link the bank no longer lists over connected and delayed, whatever the reason", () => {
    expect(shownStatus(a("connected", null, ago(1)))).toBe("not_found");
    expect(shownStatus(a("delayed", null, ago(1)))).toBe("not_found");
    expect(shownStatus(a("delayed", "unavailable", ago(1)))).toBe("not_found");
  });
  it("shows a connection that needs a sign-in or is broken first", () => {
    expect(shownStatus(a("login_required", null, ago(1)))).toBe("login_required");
    expect(shownStatus(a("login_required", "reauthorize", ago(1)))).toBe("reauthorize");
    expect(shownStatus(a("broken", null, ago(1)))).toBe("broken");
  });
  it("names the reasons", () => {
    expect(shownStatus(a("delayed", "unavailable"))).toBe("unavailable");
    expect(shownStatus(a("delayed", "unsupported"))).toBe("unsupported");
    expect(shownStatus(a("delayed"))).toBe("delayed");
    expect(shownStatus(a("login_required", "reauthorize"))).toBe("reauthorize");
    expect(shownStatus(a("connected"))).toBe("connected");
  });
  it("reads a linked account with no connection status as broken", () => {
    expect(shownStatus({ linked: true, connection_status: null })).toBe("broken");
  });
});

describe("words", () => {
  it("gives each shown status its label", () => {
    expect(shownLabel("not_found")).toBe("Account Not Found");
    expect(shownLabel("reauthorize")).toBe("Reauthorization Needed");
    expect(shownLabel("unavailable")).toBe("Direct Import is Temporarily Unavailable");
    expect(shownLabel("unsupported")).toBe("Connection Unavailable");
    expect(shownLabel("broken")).toBe("Connection Lost");
    expect(shownLabel("login_required")).toBe("Connection Repair Needed");
  });
  const acct = (over: Record<string, unknown>) => ({
    linked: true,
    closed: false,
    connection_status: "connected" as const,
    last_synced_at: ago(1) as string | null,
    ...over,
  });
  it("gives the strip of each new status", () => {
    expect(stripFor(acct({ link_missing_since: ago(2) }), undefined, NOW)).toEqual({
      kind: "not_found",
      text: RELINK_STRIP,
    });
    expect(
      stripFor(
        acct({ connection_status: "login_required", connection_reason: "reauthorize" }),
        undefined,
        NOW,
      ),
    ).toEqual({ kind: "reauthorize", text: REAUTHORIZE_STRIP });
    expect(
      stripFor(
        acct({ connection_status: "delayed", connection_reason: "unsupported" }),
        undefined,
        NOW,
      ),
    ).toBeNull();
    const late = acct({
      connection_status: "delayed",
      connection_reason: "unavailable",
      last_synced_at: ago(80),
    });
    expect(stripFor(late, undefined, NOW)?.kind).toBe("delayed");
    expect(stripFor({ ...late, closed: true }, undefined, NOW)).toBeNull();
  });
  it("gives the popup of each new status", () => {
    expect(popupFor("not_found", ago(2), NOW)).toEqual({
      title: "Account Not Found",
      line: "Last attempted 2 hours ago",
      details: RELINK_DETAILS,
      action: "relink",
    });
    expect(popupFor("reauthorize", ago(2), NOW)).toMatchObject({
      title: "Reauthorization Needed",
      details: REAUTHORIZE_STRIP,
      action: "reauthorize",
    });
    expect(popupFor("unavailable", null, NOW)).toMatchObject({
      details: UNAVAILABLE_TEXT,
      action: null,
    });
    expect(popupFor("unsupported", null, NOW)).toMatchObject({
      details: UNSUPPORTED_TEXT,
      action: null,
    });
  });
  it("names a connection and its badge from the reason", () => {
    expect(statusLabel("login_required", "reauthorize")).toBe("Reauthorization Needed");
    expect(statusLabel("delayed", "unavailable")).toBe("Direct Import is Temporarily Unavailable");
    expect(statusLabel("delayed")).toBe("Imports Delayed");
    expect(statusLabel("weird", "reauthorize")).toBe("Connection Repair Needed");
    expect(connectionBadge("login_required", "reauthorize")).toBe("Reauthorize");
    expect(connectionBadge("login_required")).toBe("Repair");
    expect(connectionBadge("delayed", "unavailable")).toBe("Unavailable");
    expect(connectionBadge("delayed", "unsupported")).toBe("Unavailable");
    expect(connectionBadge("delayed")).toBe("Delayed");
    expect(connectionBadge("connected")).toBeNull();
  });
});
