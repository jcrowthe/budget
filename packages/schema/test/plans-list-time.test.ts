import { describe, expect, it } from "vitest";
import { lastUsedText } from "../src/plans-list-time";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("lastUsedText", () => {
  const rows: [string, string | null, string][] = [
    ["null", null, "Never opened"],
    ["unreadable", "nope", "Never opened"],
    ["now", ago(0), "Last used just now"],
    ["59 s", ago(59 * S), "Last used just now"],
    ["in 5 min", ago(-5 * MIN), "Last used just now"],
    ["60 s", ago(60 * S), "Last used 1 minute ago"],
    ["59 min 59 s", ago(59 * MIN + 59 * S), "Last used 59 minutes ago"],
    ["60 min", ago(60 * MIN), "Last used 1 hour ago"],
    ["23 h 59 min", ago(23 * H + 59 * MIN), "Last used 23 hours ago"],
    ["24 h", ago(24 * H), "Last used yesterday"],
    ["47 h 59 min", ago(47 * H + 59 * MIN), "Last used yesterday"],
    ["48 h", ago(48 * H), "Last used 2 days ago"],
    ["72 h", ago(72 * H), "Last used 3 days ago"],
    ["29 d", ago(29 * D), "Last used 29 days ago"],
    ["30 d", ago(30 * D), "Last used 1 month ago"],
    ["59 d", ago(59 * D), "Last used 1 month ago"],
    ["60 d", ago(60 * D), "Last used 2 months ago"],
    ["364 d", ago(364 * D), "Last used 11 months ago"],
    ["365 d", ago(365 * D), "Last used 1 year ago"],
    ["730 d", ago(730 * D), "Last used 2 years ago"],
  ];
  for (const [name, at, text] of rows)
    it(`${name} -> ${text}`, () => expect(lastUsedText(at, NOW)).toBe(text));
});
