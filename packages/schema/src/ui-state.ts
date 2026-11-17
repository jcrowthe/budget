import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const SidebarGroupName = z
  .enum(["starred", "cash", "credit", "loans", "tracking", "closed"])
  .openapi("SidebarGroupName");

/** Interface state, one line per key. A later Build adds a key here and nowhere else. */
export const UI_STATE_FIELDS = {
  collapsed_account_groups: z.array(SidebarGroupName).max(6),
  snooze_tip_seen: z.boolean(),
  hide_register_export_dialog: z.boolean(),
  hide_reconcile_difference_dialog: z.boolean(),
};
export type UiStateKey = keyof typeof UI_STATE_FIELDS;
export const UiState = z.object(UI_STATE_FIELDS).partial().openapi("UiState");
export const UiStatePatch = z.strictObject(UI_STATE_FIELDS).partial().openapi("UiStatePatch");
export const UiStateResponse = dataEnvelope(z.object({ ui_state: UiState })).openapi(
  "UiStateResponse",
);
export type UiState = z.infer<typeof UiState>;
export type UiStatePatch = z.infer<typeof UiStatePatch>;
