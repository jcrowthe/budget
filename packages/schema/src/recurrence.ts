/**
 * Recurrence of scheduled transactions: pure arithmetic on `YYYY-MM-DD` strings (UTC, no time zone).
 * Every occurrence is computed from the series' anchor (`date_first`), so a day clamped to a short month
 * does not shift the days after it: Monthly from 12/31 gives 01/31, 02/28, 03/31, 04/30.
 */
export const FREQUENCIES = [
  "never",
  "daily",
  "weekly",
  "everyOtherWeek",
  "twiceAMonth",
  "every4Weeks",
  "monthly",
  "everyOtherMonth",
  "every3Months",
  "every4Months",
  "twiceAYear",
  "yearly",
  "everyOtherYear",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  never: "Never",
  daily: "Daily",
  weekly: "Weekly",
  everyOtherWeek: "Every other week",
  twiceAMonth: "Twice a month",
  every4Weeks: "Every 4 weeks",
  monthly: "Monthly",
  everyOtherMonth: "Every other month",
  every3Months: "Every 3 months",
  every4Months: "Every 4 months",
  twiceAYear: "Twice a year",
  yearly: "Yearly",
  everyOtherYear: "Every other year",
};

/** The tooltip of a repeating row: "Repeats monthly". Null for a one-off. */
export function repeatTooltip(f: Frequency): string | null {
  return f === "never" ? null : `Repeats ${FREQUENCY_LABELS[f].toLowerCase()}`;
}

const DAY_STEPS: Partial<Record<Frequency, number>> = {
  daily: 1,
  weekly: 7,
  everyOtherWeek: 14,
  every4Weeks: 28,
};
const MONTH_STEPS: Partial<Record<Frequency, number>> = {
  monthly: 1,
  everyOtherMonth: 2,
  every3Months: 3,
  every4Months: 4,
  twiceAYear: 6,
  yearly: 12,
  everyOtherYear: 24,
};

const MS_DAY = 86_400_000;

function parts(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}
function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}
function ymd(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dayNumber(iso: string): number {
  const { y, m, d } = parts(iso);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}
function fromDayNumber(n: number): string {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}
/** `months` after the anchor's month, keeping the anchor's day when the month has it, else its last day. */
function addMonthsClamped(anchor: string, months: number): string {
  const { y, m, d } = parts(anchor);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** The two days of a Twice a month series, from the anchor's day (design: the Lead's rule). */
function twiceDays(anchorDay: number): [number, number] {
  return anchorDay > 15 ? [anchorDay - 15, anchorDay] : [anchorDay, anchorDay + 15];
}

/** The first occurrence of the series strictly after `after`, or null when there is none (a one-off). */
export function occurrenceAfter(anchor: string, f: Frequency, after: string): string | null {
  if (anchor > after) return anchor;
  if (f === "never") return null;
  const dayStep = DAY_STEPS[f];
  if (dayStep) {
    const k = Math.floor((dayNumber(after) - dayNumber(anchor)) / dayStep) + 1;
    return fromDayNumber(dayNumber(anchor) + k * dayStep);
  }
  const monthStep = MONTH_STEPS[f];
  if (monthStep) {
    const a = parts(anchor);
    const b = parts(after);
    const diff = (b.y - a.y) * 12 + (b.m - a.m);
    let k = Math.floor(diff / monthStep);
    let cand = addMonthsClamped(anchor, k * monthStep);
    while (cand <= after) {
      k += 1;
      cand = addMonthsClamped(anchor, k * monthStep);
    }
    return cand;
  }
  // twiceAMonth: both days of the month of `after`, then of the months that follow.
  const [lo, hi] = twiceDays(parts(anchor).d);
  const b = parts(after);
  for (let i = 0; i < 3; i++) {
    const idx = b.y * 12 + (b.m - 1) + i;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const last = daysInMonth(y, m);
    for (const day of [lo, hi]) {
      const cand = ymd(y, m, Math.min(day, last));
      if (cand > after && cand >= anchor) return cand;
    }
  }
  return null;
}

/** One step: the occurrence after `current`. */
export function nextDate(anchor: string, f: Frequency, current: string): string | null {
  return occurrenceAfter(anchor, f, current);
}

/** A new transaction is saved as scheduled when its date is after today or it repeats. */
export function savesAsScheduled(date: string, f: Frequency, today: string): boolean {
  return date > today || f !== "never";
}

export type Placement =
  | { kind: "schedule"; dateNext: string }
  | { kind: "enterAndSchedule"; enterDate: string; dateNext: string }
  | { kind: "notScheduled" };

/** What saving a date with a frequency does: a schedule, a real row plus a schedule, or neither. */
export function placeSchedule(date: string, f: Frequency, today: string): Placement {
  if (date > today) return { kind: "schedule", dateNext: date };
  if (f === "never") return { kind: "notScheduled" };
  const dateNext = occurrenceAfter(date, f, today);
  if (!dateNext) return { kind: "notScheduled" };
  return { kind: "enterAndSchedule", enterDate: date, dateNext };
}

/** Due entry: null when dateNext is after `day`; else the date to enter and the new date_next (null = remove). */
export function dueStep(
  anchor: string,
  f: Frequency,
  dateNext: string,
  day: string,
): { enterDate: string; dateNext: string | null } | null {
  if (dateNext > day) return null;
  return { enterDate: dateNext, dateNext: occurrenceAfter(anchor, f, day) };
}

/** The calendar day before `iso` (the cron's day). */
export function dayBefore(iso: string): string {
  return fromDayNumber(dayNumber(iso) - 1);
}
