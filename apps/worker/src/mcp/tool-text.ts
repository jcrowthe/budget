import { z } from "zod";

/** Every id input of every tool: a non-empty string the service resolves (unknown ids are tool errors). */
export const Id = z.string().min(1);

export const MONEY =
  "Amounts are integer milliunits (1000 = one currency unit); negative is an outflow, positive an inflow.";
export const MONTH = "A month is its first day, YYYY-MM-01.";
export const DATE = "Dates are YYYY-MM-DD.";
