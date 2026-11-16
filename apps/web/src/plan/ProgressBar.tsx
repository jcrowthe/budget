// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import type { Section } from "./format";

export function ProgressBar({ sections }: { sections: Section[] }) {
  return (
    <figure className="progress-bar" role="group" aria-label="Progress">
      <div className="progress-track">
        {sections.map((sec, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: sections have no identity; they are redrawn from the figures
            key={i}
            className="progress-section"
            data-pct={sec.pct.toFixed(1)}
            data-fill={sec.fill.toFixed(1)}
            style={{ width: `${sec.pct}%` }}
          >
            {sec.parts.map((s) => (
              <div
                key={s.kind}
                className="progress-segment"
                data-kind={s.kind}
                style={{ width: `${s.pct}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </figure>
  );
}
