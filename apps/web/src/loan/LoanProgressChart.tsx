import { niceTicks } from "@budget/schema/reflect-format";
import { useEffect, useRef, useState } from "react";
import { usePlanFormatter } from "../shell/plan-formats-context";

export type Point = { month: string; balance: number };

const HEIGHT = 280;
const PAD = { left: 72, right: 16, top: 8, bottom: 24 };
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Months since year 0: a number to place a "YYYY-MM-01" on the x axis. */
const idx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/**
 * The Loan's Progress line chart, drawn like the Reflect charts (the app's own SVG): Past Balance (solid), the
 * Original Payment Schedule and the Current Track (dashed). The current track path carries its first and last
 * point as data attributes.
 */
export function LoanProgressChart({
  past,
  original,
  current,
  label = "Loan balance by month",
}: {
  past: Point[];
  original?: Point[];
  current: Point[];
  label?: string;
}) {
  const fmt = usePlanFormatter();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const all = [...past, ...(original ?? []), ...current];
  if (all.length === 0) return <div className="loan-chart" ref={box} />;
  const x0 = Math.min(...all.map((p) => idx(p.month)));
  const x1 = Math.max(...all.map((p) => idx(p.month)));
  const hi = Math.max(...all.map((p) => p.balance), 0);
  const ticks = niceTicks(0, hi);
  const max = ticks.length ? Math.max(hi, ticks[ticks.length - 1] as number) : 1000;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (m: string) => PAD.left + ((idx(m) - x0) / Math.max(1, x1 - x0)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / (max || 1)) * plotH;
  const path = (pts: Point[]) =>
    pts
      .map((p, i) => `${i ? "L" : "M"}${x(p.month).toFixed(1)},${y(p.balance).toFixed(1)}`)
      .join(" ");

  // Years when the span passes 24 months, else every other month.
  const span = x1 - x0;
  const labels: { at: number; text: string }[] = [];
  if (span > 24) {
    const y0 = Math.ceil(x0 / 12);
    const y1 = Math.floor(x1 / 12);
    const step = Math.max(1, Math.ceil((y1 - y0 + 1) / 8));
    for (let yr = y0; yr <= y1; yr += step) labels.push({ at: yr * 12, text: String(yr) });
  } else {
    for (let i = x0; i <= x1; i += 2) {
      labels.push({ at: i, text: `${SHORT[i % 12]} '${String(Math.floor(i / 12)).slice(2)}` });
    }
  }
  const xAt = (i: number) => PAD.left + ((i - x0) / Math.max(1, span)) * plotW;
  const first = current[0];
  const last = current[current.length - 1];

  return (
    <div className="loan-chart" ref={box} style={{ height: HEIGHT }}>
      <svg width={width} height={HEIGHT} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="loan-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text
              className="loan-tick"
              x={PAD.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fmt.whole(t)}
            </text>
          </g>
        ))}
        {labels.map((l) => (
          <text
            key={l.at}
            className="loan-tick"
            x={xAt(l.at)}
            y={PAD.top + plotH + 8}
            textAnchor="middle"
            dominantBaseline="hanging"
          >
            {l.text}
          </text>
        ))}
        {original && original.length > 1 ? (
          <path
            className="loan-line original"
            data-series="original"
            d={path(original)}
            fill="none"
          />
        ) : null}
        {past.length > 0 ? (
          <path className="loan-line past" data-series="past" d={path(past)} fill="none" />
        ) : null}
        {current.length > 0 && first && last ? (
          <path
            className="loan-line current"
            data-series="current"
            data-start-month={first.month}
            data-start-balance={first.balance}
            data-end-month={last.month}
            data-end-balance={last.balance}
            d={path(current)}
            fill="none"
            strokeDasharray="6 4"
          />
        ) : null}
      </svg>
    </div>
  );
}
