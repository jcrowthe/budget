import { type PlanFormatter, planFormatter } from "@budget/schema/plan-formats";
import { currencyFormatOf, formatsFromImport } from "@budget/schema/plan-formats-catalogue";
import type { ImportFormats } from "@budget/schema/plan-import";

/** The formatter of the plan the file would make: the formats the Worker stores for it (`importedFormatColumns`). */
export function previewFormatter(formats: ImportFormats): PlanFormatter {
  const s = formatsFromImport(formats);
  return planFormatter({
    currency_format: currencyFormatOf(s.iso_code, s.example_format, s.symbol_placement),
    date_format: { format: s.date_format },
  });
}

/** A date written out with its month name, so no date format is assumed. */
export function questionDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}
