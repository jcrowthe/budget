import { useEffect } from "react";
import { cacheTheme, useSettings } from "../api/settings";
import { useEffectiveSettings, usePreview } from "./displayStore";
import { resolveTheme, themeClass } from "./theme";

const QUERY = "(prefers-color-scheme: dark)";

/** Puts the effective theme and balance style on <html> (and the dark class on <body>); renders nothing. */
export function DisplaySync() {
  const { theme, balance_style } = useEffectiveSettings();
  const { isPlaceholderData, isSuccess, data } = useSettings();
  const loaded = isSuccess && !isPlaceholderData;
  // Until the saved settings arrive (or if they never do) the first-paint class from index.html stays: a placeholder or a failed load is not a choice.
  const preview = usePreview();
  const settled = loaded || preview !== null;

  useEffect(() => {
    if (!settled) return;
    const mq = window.matchMedia(QUERY);
    const apply = () => {
      const resolved = resolveTheme(theme, mq.matches);
      const root = document.documentElement;
      root.classList.remove("theme-dark", "theme-light");
      root.classList.add(themeClass(resolved));
      document.body.classList.toggle("theme-dark", resolved === "dark");
    };
    apply();
    if (theme !== "match_system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, settled]);

  useEffect(() => {
    if (!settled) return;
    document.documentElement.classList.toggle(
      "balance-no-color",
      balance_style === "differentiate_without_color",
    );
  }, [balance_style, settled]);

  // The first-paint script reads this copy; keep it equal to the saved value.
  useEffect(() => {
    if (loaded && data) cacheTheme(data.theme);
  }, [loaded, data]);

  return null;
}
