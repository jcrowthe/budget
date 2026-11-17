const two = (n: number) => String(n).padStart(2, "0");

/** Today's date in the browser's local time zone, as ISO. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
