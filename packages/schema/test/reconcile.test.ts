import { describe, expect, it } from "vitest";
import { reconciledAgo, reconciledTitle, reconcileSentence } from "../src/reconcile";

describe("reconcileSentence", () => {
  const head = "This account's cleared balance in Budget is";
  it("says higher, lower and the same", () => {
    expect(reconcileSentence(-100000)).toBe(`${head} $100.00 higher than your actual account.`);
    expect(reconcileSentence(144500)).toBe(`${head} $144.50 lower than your actual account.`);
    expect(reconcileSentence(0)).toBe(`${head} the same as your actual account.`);
    expect(reconcileSentence(-1234567890)).toBe(
      `${head} $1,234,567.89 higher than your actual account.`,
    );
  });
});

describe("reconciledAgo", () => {
  const T = Date.UTC(2026, 10, 16, 12, 0, 0);
  const ago = (s: number) => reconciledAgo(new Date(T - s * 1000).toISOString(), T);
  const MIN = 60;
  const H = 3600;
  const D = 86400;
  it("follows the thresholds at their boundaries", () => {
    expect(ago(44)).toBe("a few seconds ago");
    expect(ago(45)).toBe("a minute ago");
    expect(ago(89)).toBe("a minute ago");
    expect(ago(90)).toBe("2 minutes ago");
    expect(ago(44 * MIN)).toBe("44 minutes ago");
    expect(ago(45 * MIN)).toBe("an hour ago");
    expect(ago(21 * H)).toBe("21 hours ago");
    expect(ago(22 * H)).toBe("a day ago");
    expect(ago(35 * H)).toBe("a day ago");
    expect(ago(36 * H)).toBe("2 days ago");
    expect(ago(25 * D)).toBe("25 days ago");
    expect(ago(26 * D)).toBe("a month ago");
    expect(ago(45 * D)).toBe("a month ago");
    expect(ago(46 * D)).toBe("2 months ago");
    expect(ago(319 * D)).toBe("10 months ago");
    expect(ago(320 * D)).toBe("a year ago");
    expect(ago(547 * D)).toBe("a year ago");
    expect(ago(548 * D)).toBe("2 years ago");
  });
  it("reads a future time as a few seconds ago", () => {
    expect(reconciledAgo(new Date(T + 3600_000).toISOString(), T)).toBe("a few seconds ago");
  });
  it("titles in the en-US medium format", () => {
    expect(reconciledTitle(new Date(T).toISOString())).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s(AM|PM)$/,
    );
  });
});
