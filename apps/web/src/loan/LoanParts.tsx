import { useId } from "react";

/** A labelled figure (`role="group"`), as the loan page's tiles and the simulator's summary. */
export function Tile({ label, value }: { label: string; value: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own box
    <div className="loan-tile" role="group" aria-label={label}>
      <span className="loan-tile-label">{label}</span>
      <span className="loan-tile-value">{value}</span>
    </div>
  );
}

/** A chart legend entry with an "i" button and its tooltip. */
export function Legend({ cls, label, tip }: { cls: string; label: string; tip: string }) {
  const id = useId();
  return (
    <li className="loan-legend-item">
      <span className={`loan-swatch ${cls}`} aria-hidden="true" />
      {label}
      <span className="loan-info-wrap">
        <button
          type="button"
          className="loan-info"
          aria-label={`About ${label}`}
          aria-describedby={id}
        >
          i
        </button>
        <span role="tooltip" id={id} className="loan-tip">
          {tip}
        </span>
      </span>
    </li>
  );
}
