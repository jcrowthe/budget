import { CheckIcon, MinusIcon } from "./icons";

/** The register's checkbox: a custom box with a "mixed" state. */
export function Box({
  state,
  label,
  onClick,
  tabIndex,
}: {
  state: boolean | "mixed";
  label: string;
  onClick: () => void;
  tabIndex?: number;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a custom box with a "mixed" state, drawn as the source does
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      tabIndex={tabIndex}
      className={`register-checkbox${state ? " is-on" : ""}`}
      onClick={onClick}
    >
      <span className="box">
        {state === "mixed" ? <MinusIcon /> : state ? <CheckIcon /> : null}
      </span>
    </button>
  );
}
