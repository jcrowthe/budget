// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import type { Segment } from "./format";

export function ProgressBar({ segments }: { segments: Segment[] }) {
  return (
    <figure className="progress-bar" role="group" aria-label="Progress">
      <div className="progress-track">
        {segments.map((s) => (
          <div
            key={s.kind}
            className="progress-segment"
            data-kind={s.kind}
            style={{ width: `${s.pct}%` }}
          />
        ))}
      </div>
    </figure>
  );
}
