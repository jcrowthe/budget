import { z } from "@hono/zod-openapi";

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO 8601 date");
export const IsoDateTime = z.iso.datetime();
/** A month is its first day, e.g. 2026-11-01. */
export const Month = IsoDate.regex(
  /^\d{4}-(0[1-9]|1[0-2])-01$/,
  "Expected the first day of a month",
);
