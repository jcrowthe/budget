import type { Month } from "@budget/core/month";
import { longMonth } from "../format";

const index = (m: Month) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/** "December"; a year is added for a month 12 or more ahead of `current` ("November 2027"). */
export function futureMonthLabel(month: Month, current: Month): string {
  return index(month) - index(current) < 12
    ? longMonth(month)
    : `${longMonth(month)} ${month.slice(0, 4)}`;
}
