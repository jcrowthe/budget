import type { SpendingItem } from "@budget/schema/reports";
import { useEffect, useRef, useState } from "react";
import { money } from "./format";

/** Slice colour by rank: eight slots, then one for the rest (custom properties in spending-breakdown.css). */
export const sliceColor = (rank: number): string =>
  rank < 8 ? `var(--sb-slice-${rank + 1})` : "var(--sb-slice-other)";

/** Outside labels only for slices of at least this share: between the ticket's 6% (none) and 11% (labelled). */
export const LABEL_MIN_PCT = 10;

const GAP = 3;
const START = -Math.PI / 2;

const point = (cx: number, cy: number, r: number, a: number) =>
  `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;

function ringPath(cx: number, cy: number, R: number, r: number): string {
  const circle = (rad: number) =>
    `M${cx - rad},${cy} A${rad},${rad} 0 1 0 ${cx + rad},${cy} A${rad},${rad} 0 1 0 ${cx - rad},${cy} Z`;
  return `${circle(R)} ${circle(r)}`;
}

function arcPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${point(cx, cy, R, a0)} A${R},${R} 0 ${large} 1 ${point(cx, cy, R, a1)} L${point(cx, cy, r, a1)} A${r},${r} 0 ${large} 0 ${point(cx, cy, r, a0)} Z`;
}

export function SpendingDonut({
  items,
  total,
  hoverId,
  onHover,
  onPick,
}: {
  items: SpendingItem[];
  total: number;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onPick: (item: SpendingItem, x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // Source: a 1.3:1 box, the ring's outer radius 0.375 of its height, the hole 0.6 of that.
  const height = Math.min(960, Math.max(464, width / 1.3));
  const R = Math.max(90, 0.375 * height);
  const r = 0.6 * R;
  const cx = width / 2;
  const cy = height / 2;

  let angle = START;
  const slices = items.map((item, i) => {
    const sweep = total > 0 ? (item.total / total) * 2 * Math.PI : 0;
    const a0 = angle;
    angle += sweep;
    return { item, rank: i, a0, a1: angle, mid: (a0 + angle) / 2 };
  });
  const hovered = slices.find((s) => s.item.id === hoverId);
  const dim = hoverId !== null && !!hovered;

  return (
    <div className="sb-donut" ref={box} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Spending breakdown">
        {slices.length === 0 && (
          <path className="sb-empty-ring" d={ringPath(cx, cy, R, r)} fillRule="evenodd" />
        )}
        {slices.map((s) => {
          const single = slices.length === 1;
          const outer = hovered === s ? R * 1.03 : R;
          const gap = single || s.a1 - s.a0 < 0.02 ? 0 : GAP;
          const pm = point(cx, cy, (R + r) / 2, s.mid).split(",");
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only; the list holds the same actions for the keyboard
            <path
              key={s.item.id}
              className="sb-slice"
              data-id={s.item.id}
              data-px={pm[0]}
              data-py={pm[1]}
              d={single ? ringPath(cx, cy, outer, r) : arcPath(cx, cy, outer, r, s.a0, s.a1)}
              fillRule="evenodd"
              fill={sliceColor(s.rank)}
              strokeWidth={gap}
              opacity={dim && hovered !== s ? 0.4 : 1}
              onMouseEnter={() => onHover(s.item.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => onPick(s.item, e.clientX, e.clientY)}
            />
          );
        })}
        {slices
          .filter((s) => s.item.share_pct >= LABEL_MIN_PCT)
          .map((s) => {
            const lx = cx + (R + 28) * Math.cos(s.mid);
            const ly = cy + (R + 28) * Math.sin(s.mid);
            const right = Math.cos(s.mid) >= 0;
            return (
              <text
                key={s.item.id}
                className="sb-label"
                x={lx}
                y={ly}
                textAnchor={right ? "start" : "end"}
                opacity={dim && hovered !== s ? 0.4 : 1}
              >
                <tspan className="sb-label-name" x={lx} dy="-0.2em">
                  {s.item.name}
                </tspan>
                <tspan className="sb-label-value" x={lx} dy="1.3em">
                  {`${money(s.item.total)} (${s.item.share_pct}%)`}
                </tspan>
              </text>
            );
          })}
      </svg>
      <div className="sb-centre" style={{ left: cx, top: cy }}>
        {hovered ? (
          <>
            <span className="sb-centre-label" data-testid="sb-centre-name">
              {hovered.item.name}
            </span>
            <span className="sb-centre-amount" data-testid="sb-centre-amount">
              {money(hovered.item.total)}
            </span>
            <span className="sb-centre-pct" data-testid="sb-centre-pct">
              {hovered.item.share_pct}%
            </span>
          </>
        ) : (
          <>
            <span className="sb-centre-label" data-testid="sb-centre-name">
              Total Spending
            </span>
            <span className="sb-centre-amount" data-testid="sb-centre-amount">
              {money(total)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
