import { describe, expect, it } from "vitest";
import {
  SCHEDULED_CATEGORIZE_NONE,
  SCHEDULED_LATER,
  ScheduledBulkRequest,
  scheduledCategorizeSkip,
  scheduledMirrorMoveText,
  scheduledSkipText,
} from "../src/scheduled-transactions";

const ok = (b: unknown) => ScheduledBulkRequest.safeParse(b).success;

describe("scheduled bulk request", () => {
  it("parses each op", () => {
    expect(ok({ op: "enter_now", ids: ["a"] })).toBe(true);
    expect(ok({ op: "delete", ids: ["a"] })).toBe(true);
    expect(ok({ op: "categorize", ids: ["a"], value: "c1" })).toBe(true);
    expect(ok({ op: "categorize", ids: ["a"], value: "ready_to_assign" })).toBe(true);
    expect(ok({ op: "flag", ids: ["a"], value: "red" })).toBe(true);
    expect(ok({ op: "flag", ids: ["a"], value: null })).toBe(true);
    expect(ok({ op: "memo", ids: ["a"], value: "ZZ-TEST memo" })).toBe(true);
    expect(ok({ op: "memo", ids: ["a"], value: null })).toBe(true);
    expect(ok({ op: "move", ids: ["a", "b"], value: "acc", mirror_ids: ["b"] })).toBe(true);
    expect(ok({ op: "move", ids: ["a"], value: "acc" })).toBe(true);
  });
  it("refuses what is not strict", () => {
    expect(ok({ op: "enter_now", ids: ["a"], value: "x" })).toBe(false);
    expect(ok({ op: "memo", ids: ["a"], value: "x", mirror_ids: ["a"] })).toBe(false);
    expect(ok({ op: "move", ids: ["a"], value: "acc", mirror_ids: ["z"] })).toBe(false);
    expect(
      ok({ op: "flag", ids: Array.from({ length: 101 }, (_, i) => `${i}`), value: "red" }),
    ).toBe(false);
    expect(ok({ op: "memo", ids: ["a"], value: "x".repeat(501) })).toBe(false);
    expect(ok({ op: "flag", ids: ["a"], value: "pink" })).toBe(false);
    expect(ok({ op: "categorize", ids: ["a"], value: "" })).toBe(false);
  });
});

describe("scheduledCategorizeSkip", () => {
  const plain = (onBudget: boolean) => ({ split: false, onBudget, other: null });
  it("splits and tracking accounts", () => {
    expect(scheduledCategorizeSkip({ ...plain(true), split: true })).toBe("split");
    expect(scheduledCategorizeSkip(plain(false))).toBe("tracking_account");
    expect(scheduledCategorizeSkip(plain(true))).toBeNull();
  });
  it("transfers", () => {
    const t = (a: boolean, b: boolean) =>
      scheduledCategorizeSkip({ split: false, onBudget: a, other: { onBudget: b } });
    expect(t(true, true)).toBe("category_not_needed");
    expect(t(false, false)).toBe("tracking_account");
    expect(t(true, false)).toBeNull();
    expect(t(false, true)).toBeNull();
  });
});

describe("scheduledSkipText", () => {
  it("has a text for every reason", () => {
    const o = { seriesAccountName: "ZZ A" };
    expect(scheduledSkipText("split", o)).toBe("A split's category is in its lines");
    expect(scheduledSkipText("tracking_account", o)).toBe(
      "A tracking account's transactions take no category",
    );
    expect(scheduledSkipText("category_not_needed", o)).toBe(
      "A transfer between on-plan accounts takes no category",
    );
    expect(scheduledSkipText("unchanged", o)).toBe("Already set");
    expect(scheduledSkipText("changed", o)).toBe("The scheduled transaction changed; reload it");
    expect(scheduledSkipText("mirror", o)).toBe("Scheduled in ZZ A: move it there");
    expect(scheduledMirrorMoveText("ZZ A")).toBe("Scheduled in ZZ A: move it there");
    expect(SCHEDULED_LATER).toBe("Not available for scheduled transactions yet");
    expect(SCHEDULED_CATEGORIZE_NONE).toContain("takes a category");
  });
});
