/** The browser's local date as YYYY-MM-DD: the owner's "today" that month reads and target writes send. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(now.getFullYear(), 4)}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
