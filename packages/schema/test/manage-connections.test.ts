import { describe, expect, it } from "vitest";
import {
  accountCountLabel,
  connectionBadge,
  connectionGroup,
  resetAvailableAt,
  statusLabel,
} from "../src/manage-connections";

describe("manage connections rules", () => {
  it("groups the four statuses and an unknown one", () => {
    expect(connectionGroup("connected")).toBe("others");
    expect(connectionGroup("delayed")).toBe("delayed");
    expect(connectionGroup("login_required")).toBe("attention");
    expect(connectionGroup("broken")).toBe("attention");
    expect(connectionGroup("weird")).toBe("attention");
  });
  it("labels and badges", () => {
    expect(statusLabel("connected")).toBe("Connected");
    expect(statusLabel("delayed")).toBe("Imports Delayed");
    expect(statusLabel("broken")).toBe("Connection Repair Needed");
    expect(statusLabel("weird")).toBe("Connection Repair Needed");
    expect(connectionBadge("connected")).toBeNull();
    expect(connectionBadge("delayed")).toBe("Delayed");
    expect(connectionBadge("login_required")).toBe("Repair");
  });
  it("counts accounts", () => {
    expect(accountCountLabel(1)).toBe("1 Account");
    expect(accountCountLabel(2)).toBe("2 Accounts");
    expect(accountCountLabel(0)).toBe("0 Accounts");
  });
  it("waits 24 hours after a reset", () => {
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    expect(resetAvailableAt(null, now)).toBeNull();
    expect(resetAvailableAt(new Date(now - 24 * 3600_000 + 1000).toISOString(), now)).toBe(
      new Date(now + 1000).toISOString(),
    );
    expect(resetAvailableAt(new Date(now - 24 * 3600_000 - 1000).toISOString(), now)).toBeNull();
  });
});
