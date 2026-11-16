import { capLabel, isMacPlatform } from "./keys";
import type { Cap } from "./registry";

const MAC = typeof navigator !== "undefined" && isMacPlatform(navigator);

export function KeyCaps({
  caps,
  variant,
}: {
  caps: readonly Cap[];
  variant: "dialog" | "tooltip";
}) {
  return (
    <span className={`key-caps is-${variant}`}>
      {caps.map((cap, i) =>
        typeof cap !== "string" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: caps are a fixed list
          <span key={i} className="key-cap then">
            then
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: caps are a fixed list
          <kbd key={i} className="key-cap">
            {capLabel(cap, MAC)}
          </kbd>
        ),
      )}
    </span>
  );
}
