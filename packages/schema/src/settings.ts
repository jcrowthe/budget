import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const Theme = z.enum(["default", "dark", "match_system"]);
export const BalanceStyle = z.enum(["default", "differentiate_without_color"]);

export const Settings = z
  .object({
    theme: Theme.openapi({ description: "default is the light theme" }),
    progress_bars: z.boolean(),
    balance_style: BalanceStyle,
  })
  .openapi("Settings", { description: "The signed-in user's display options (not per plan)." });
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = z
  .object({
    theme: Theme.optional(),
    progress_bars: z.boolean().optional(),
    balance_style: BalanceStyle.optional(),
  })
  .strict()
  .openapi("SettingsPatch", { description: "Any of the fields; the others keep their value." });
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const SettingsResponse = dataEnvelope(Settings).openapi("SettingsResponse");

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  progress_bars: true,
  balance_style: "default",
};
