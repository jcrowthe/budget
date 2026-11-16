/** The clock of Export Plan and Import Plan. A seam: tests assign `now` and restore it. */
export const planClock = { now: (): Date => new Date() };
