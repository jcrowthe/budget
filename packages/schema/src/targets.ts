import { z } from "@hono/zod-openapi";
import { IsoDate, Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";

// The enum values repeat core's constants (the schema package does not import core); a Worker test asserts equality.

/** True only for a real calendar date: "2027-02-30" round-trips to a different string. */
function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const YEAR_RANGE = /^(19|20|21)\d{2}-/;

export const TargetCadence = z
  .enum(["weekly", "monthly", "yearly", "custom"])
  .openapi("TargetCadence");
export const TargetBehavior = z
  .enum(["set_aside", "refill", "fill_up", "balance"])
  .openapi("TargetBehavior");
export const TargetStatus = z
  .enum(["underfunded", "funded", "on_track", "eventually", "snoozed", "complete"])
  .openapi("TargetStatus");
export const RepeatUnit = z.enum(["month", "year"]).openapi("RepeatUnit");

export const TargetRepeat = z
  .object({ every: z.number().int().min(1).max(11), unit: RepeatUnit })
  .openapi("TargetRepeat");

export const TargetDefinition = z
  .object({
    cadence: TargetCadence,
    behavior: TargetBehavior,
    amount: Milliunits,
    day_of_week: z.number().int().nullable(),
    day_of_month: z.number().int().nullable(),
    due_date: IsoDate.nullable(),
    due_month: Month.nullable(),
    repeat: TargetRepeat.nullable(),
    created_on: IsoDate,
  })
  .openapi("TargetDefinition");

export const CategoryTargetMonth = z
  .object({
    definition: TargetDefinition,
    status: TargetStatus,
    needed_this_month: Milliunits,
    amount_this_month: Milliunits,
    funded: Milliunits,
    to_go_this_month: Milliunits,
    overall_to_go: Milliunits,
    overfunded: Milliunits,
    percent: z.number().int().min(0).max(100),
    due_this_month: z.boolean(),
    period_due_date: IsoDate.nullable(),
  })
  .openapi("CategoryTargetMonth");

export const Target = TargetDefinition.extend({
  budget_id: z.uuid(),
  category_id: z.uuid(),
  created_month: Month,
}).openapi("Target");

const absent = (v: unknown) => v === undefined || v === null;

const targetFields = {
  cadence: TargetCadence,
  behavior: TargetBehavior,
  amount: Milliunits.positive({ message: "amount must be greater than 0" }),
  day_of_week: z.number().int().min(0).max(6).nullish(),
  day_of_month: z.number().int().min(1).max(31).nullish(),
  due_date: IsoDate.refine((s) => isCalendarDate(s) && YEAR_RANGE.test(s), {
    message: "due_date must be a real calendar date between 1900 and 2199",
  }).nullish(),
  due_month: Month.regex(YEAR_RANGE, "Year must be between 1900 and 2199").nullish(),
  repeat: TargetRepeat.nullish(),
};

type TargetFields = {
  cadence: TargetCadence;
  behavior: TargetBehavior;
  day_of_week?: number | null;
  day_of_month?: number | null;
  due_date?: string | null;
  due_month?: string | null;
  repeat?: unknown;
};

/** The rules for which fields go with which kind of target (shared by TargetSet and TargetBody). */
export function checkTargetCombination(
  v: TargetFields,
  ctx: { addIssue: (issue: { code: "custom"; message: string; path: string[] }) => void },
): void {
  const bad = (message: string, path: string) =>
    ctx.addIssue({ code: "custom", message, path: [path] });
  const must = (field: keyof TargetFields, name: string) => {
    if (absent(v[field])) bad(`${name} is required for this target`, name);
  };
  const none = (...fields: (keyof TargetFields)[]) => {
    for (const f of fields) if (!absent(v[f])) bad(`${f} does not apply to this target`, f);
  };
  switch (v.cadence) {
    case "weekly":
      if (v.behavior !== "set_aside" && v.behavior !== "refill") {
        bad("A weekly target is set_aside or refill", "behavior");
      }
      must("day_of_week", "day_of_week");
      none("day_of_month", "due_date", "due_month", "repeat");
      break;
    case "monthly":
      if (v.behavior !== "set_aside" && v.behavior !== "refill") {
        bad("A monthly target is set_aside or refill", "behavior");
      }
      none("day_of_week", "due_date", "due_month", "repeat");
      break;
    case "yearly":
      if (v.behavior !== "set_aside" && v.behavior !== "refill") {
        bad("A yearly target is set_aside or refill", "behavior");
      }
      must("due_date", "due_date");
      none("day_of_week", "day_of_month", "due_month", "repeat");
      break;
    case "custom":
      if (v.behavior === "refill") {
        bad("A custom target is set_aside, fill_up or balance", "behavior");
      } else if (v.behavior === "balance") {
        none("day_of_week", "day_of_month", "due_date", "repeat");
      } else {
        must("due_date", "due_date");
        none("day_of_week", "day_of_month", "due_month");
      }
      break;
  }
}

export const TargetSet = z
  .object({ budget_id: z.uuid(), category_id: z.uuid(), ...targetFields })
  .superRefine(checkTargetCombination)
  .openapi("TargetSet");

/** The body of PUT .../categories/{category_id}/target: TargetSet without the ids. */
export const TargetBody = z
  .object(targetFields)
  .superRefine(checkTargetCombination)
  .openapi("TargetBody");

/** The owner's local date, sent with reads and writes so that targets use their calendar. */
export const Today = IsoDate.refine((s) => isCalendarDate(s) && YEAR_RANGE.test(s), {
  message: "today must be a real date, YYYY-MM-DD",
});

export const TargetSnoozeBody = z.object({ snoozed: z.boolean() }).openapi("TargetSnoozeBody");
export const TargetSnooze = z
  .object({ month: Month, category_id: z.uuid(), snoozed: z.boolean() })
  .openapi("TargetSnooze");
export const TargetSnoozeResponse = dataEnvelope(TargetSnooze).openapi("TargetSnoozeResponse");

export const TargetResponse = dataEnvelope(z.object({ target: Target })).openapi("TargetResponse");
export const TargetDeletedResponse = dataEnvelope(z.object({ deleted: Target })).openapi(
  "TargetDeletedResponse",
);

export const TargetDelete = z
  .object({ budget_id: z.uuid(), category_id: z.uuid() })
  .openapi("TargetDelete");

export type TargetCadence = z.infer<typeof TargetCadence>;
export type TargetBehavior = z.infer<typeof TargetBehavior>;
export type TargetStatus = z.infer<typeof TargetStatus>;
export type RepeatUnit = z.infer<typeof RepeatUnit>;
export type TargetRepeat = z.infer<typeof TargetRepeat>;
export type TargetDefinition = z.infer<typeof TargetDefinition>;
export type CategoryTargetMonth = z.infer<typeof CategoryTargetMonth>;
export type Target = z.infer<typeof Target>;
export type TargetSet = z.input<typeof TargetSet>;
export type TargetBody = z.input<typeof TargetBody>;
export type TargetDelete = z.infer<typeof TargetDelete>;
export type TargetSnooze = z.infer<typeof TargetSnooze>;
