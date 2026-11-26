import type { Settings } from "@budget/schema/settings";

export type ThemeChoice = Settings["theme"];

/** `default` is the light theme, `match_system` follows the OS colour scheme. */
export function resolveTheme(theme: ThemeChoice, prefersDark: boolean): "dark" | "light" {
  if (theme === "default") return "light";
  if (theme === "match_system") return prefersDark ? "dark" : "light";
  return "dark";
}

export const themeClass = (resolved: "dark" | "light") => `theme-${resolved}`;

export const THEME_ORDER: readonly ThemeChoice[] = ["default", "dark", "match_system"];

/** The card `step` places from `current`, wrapping around: ←/→ cycle the theme cards. */
export function cycleTheme(current: ThemeChoice, step: 1 | -1): ThemeChoice {
  const i = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(i + step + THEME_ORDER.length) % THEME_ORDER.length] as ThemeChoice;
}
