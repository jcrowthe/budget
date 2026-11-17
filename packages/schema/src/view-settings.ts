import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";

export const VIEW_PRESETS = [
  "this_month",
  "last_month",
  "latest_3_months",
  "this_year",
  "last_year",
  "all_dates",
  "custom",
] as const;
export const ViewPreset = z.enum(VIEW_PRESETS).openapi("ViewPreset");
export type ViewPreset = z.infer<typeof ViewPreset>;

export const AllAccountsViewSettings = z
  .object({
    preset: ViewPreset,
    range_from: Month.nullable(),
    range_to: Month.nullable(),
    show_reconciled: z.boolean(),
    show_flags: z.boolean(),
    show_images: z.boolean(),
  })
  .openapi("AllAccountsViewSettings");

export const AccountViewSettings = AllAccountsViewSettings.extend({
  account_id: z.string(),
  show_running_balance: z.boolean(),
}).openapi("AccountViewSettings");

const accountFields = AccountViewSettings.omit({ account_id: true });
export const AccountViewSettingsUpdate = z
  .strictObject(accountFields.shape)
  .partial()
  .openapi("AccountViewSettingsUpdate");
export const AllAccountsViewSettingsUpdate = z
  .strictObject(AllAccountsViewSettings.shape)
  .partial()
  .openapi("AllAccountsViewSettingsUpdate");

export const AccountViewSettingsResponse = dataEnvelope(
  z.object({ view_settings: AccountViewSettings }),
).openapi("AccountViewSettingsResponse");
export const AllAccountsViewSettingsResponse = dataEnvelope(
  z.object({ view_settings: AllAccountsViewSettings }),
).openapi("AllAccountsViewSettingsResponse");

export type AllAccountsViewSettings = z.infer<typeof AllAccountsViewSettings>;
export type AccountViewSettings = z.infer<typeof AccountViewSettings>;
/** The settings the register reads: the account's, or All Accounts' (no running balance). */
export type ViewSettings = AllAccountsViewSettings & { show_running_balance: boolean };

export const VIEW_DEFAULTS: ViewSettings = {
  preset: "all_dates",
  range_from: null,
  range_to: null,
  show_reconciled: false,
  show_running_balance: false,
  show_flags: true,
  show_images: true,
};

type Patch = Partial<ViewSettings>;

/** Merges a partial update into the settings (design D2). Returns `{ error }` for a refused combination. */
export function mergeViewSettings<T extends ViewSettings>(
  current: T,
  patch: Patch,
): T | { error: string } {
  const next: T = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  const hasRange = patch.range_from !== undefined || patch.range_to !== undefined;
  if (patch.preset !== undefined) {
    if (patch.preset !== "custom") {
      if (hasRange && (patch.range_from != null || patch.range_to != null))
        return { error: "A range goes only with preset custom" };
      next.range_from = null;
      next.range_to = null;
    }
  } else if (hasRange) {
    next.preset = "custom";
  }
  if (next.preset === "custom" && (!next.range_from || !next.range_to))
    return { error: "Preset custom needs range_from and range_to" };
  if (next.preset !== "custom" && (next.range_from || next.range_to)) {
    next.range_from = null;
    next.range_to = null;
  }
  return next;
}
