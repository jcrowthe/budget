const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/**
 * The plans page's "Last used" line, from floors of the elapsed time (no calendar):
 * never opened or unreadable -> "Never opened"; under a minute or in the future -> "just now";
 * minutes, hours, "yesterday" (24-47 h), days (to 29), months (30-364 days, at most 11), years.
 */
export function lastUsedText(lastOpenedAt: string | null, now: number): string {
  if (lastOpenedAt === null) return "Never opened";
  const then = Date.parse(lastOpenedAt);
  if (Number.isNaN(then)) return "Never opened";
  const ms = now - then;
  if (ms < MIN) return "Last used just now";
  if (ms < HOUR) return `Last used ${plural(Math.floor(ms / MIN), "minute")}`;
  if (ms < DAY) return `Last used ${plural(Math.floor(ms / HOUR), "hour")}`;
  const days = Math.floor(ms / DAY);
  if (days < 2) return "Last used yesterday";
  if (days < 30) return `Last used ${plural(days, "day")}`;
  if (days < 365) return `Last used ${plural(Math.min(11, Math.floor(days / 30)), "month")}`;
  return `Last used ${plural(Math.floor(days / 365), "year")}`;
}
