import { DEFAULT_FORMATTER, type PlanFormatter } from "./plan-formats";
import { isCalendarDate } from "./transactions";

/** Entry-row dates: ISO strings in, ISO strings out, UTC arithmetic, `today` always passed in. */

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function parts(isoDate: string): { y: number; m: number; d: number } {
  return {
    y: Number(isoDate.slice(0, 4)),
    m: Number(isoDate.slice(5, 7)),
    d: Number(isoDate.slice(8, 10)),
  };
}

/** `2026-11-15` in the plan's date format (`11/15/2026` by default). */
export function formatEntryDate(isoDate: string, fmt: PlanFormatter = DEFAULT_FORMATTER): string {
  return fmt.date(isoDate);
}

const validYear = (y: number) => y >= 1900 && y <= 2199;

/** The order of day, month and year a date format writes. */
export type DateOrder = "MDY" | "DMY" | "YMD";
export function dateOrder(format: string): DateOrder {
  if (format.startsWith("YYYY")) return "YMD";
  return format.startsWith("DD") ? "DMY" : "MDY";
}

/** Typed text → ISO date, or null when it is not a calendar date. ISO `YYYY-M-D` is always accepted. */
export function parseEntryDate(
  text: string,
  today: string,
  order: DateOrder = "MDY",
): string | null {
  const t = text.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const nums = isoMatch ? [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])] : null;
  let y: number;
  let m: number;
  let d: number;
  if (nums) {
    [y, m, d] = nums as [number, number, number];
  } else {
    const bits = t.split(/[/.-]/);
    if (bits.length < 1 || bits.length > 3 || bits.some((b) => !/^\d{1,4}$/.test(b))) return null;
    const n = bits.map(Number);
    const now = parts(today);
    if (n.length === 3) {
      const yi = order === "YMD" ? 0 : 2;
      const ys = bits[yi] as string;
      if (order === "YMD" && ys.length !== 4) return null;
      if (ys.length === 2) y = 2000 + (n[yi] as number);
      else if (ys.length === 4) y = n[yi] as number;
      else return null;
      const [p, q] = order === "YMD" ? [n[1], n[2]] : [n[0], n[1]];
      if (order === "DMY") [d, m] = [p as number, q as number];
      else [m, d] = [p as number, q as number];
    } else if (n.length === 2) {
      y = now.y;
      if (order === "DMY") [d, m] = [n[0] as number, n[1] as number];
      else [m, d] = [n[0] as number, n[1] as number];
    } else {
      y = now.y;
      if (order === "DMY") [d, m] = [n[0] as number, now.m];
      else [m, d] = [n[0] as number, 1];
    }
  }
  if (!validYear(y)) return null;
  const s = iso(y, m, d);
  return isCalendarDate(s) ? s : null;
}

function shift(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The date a key leads to from `base`, or null when the key is not a shortcut. */
export function dateKeyAction(key: string, base: string, today: string): string | null {
  const { y, m } = parts(base);
  switch (key) {
    case "-":
      return shift(base, -1);
    case "+":
    case "=":
      return shift(base, 1);
    case "ArrowUp":
      return shift(base, -7);
    case "ArrowDown":
      return shift(base, 7);
    case "t":
      return today;
    case "m":
      return iso(y, m, 1);
    case "M":
      return iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
    case "y":
      return iso(y, 1, 1);
    case "r":
    case "Y":
      return iso(y, 12, 31);
    default:
      return null;
  }
}

/** Weeks of 7 cells (Sunday first) for the month starting `firstOfMonth`; `null` outside the month. */
export function monthGrid(firstOfMonth: string): (string | null)[][] {
  const { y, m } = parts(firstOfMonth);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => iso(y, m, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The first of the month `n` months from `firstOfMonth`. */
export function addMonths(firstOfMonth: string, n: number): string {
  const { y, m } = parts(firstOfMonth);
  const idx = y * 12 + (m - 1) + n;
  return iso(Math.floor(idx / 12), (idx % 12) + 1, 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-11-01` → `Nov 2026`. */
export function monthTitle(firstOfMonth: string): string {
  const { y, m } = parts(firstOfMonth);
  return `${MONTHS[m - 1]} ${y}`;
}
