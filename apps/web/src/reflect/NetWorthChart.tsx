import { monthLabel, shortMonthLabel } from "@budget/schema/report-range";
import type { NetWorth } from "@budget/schema/reports";
import { useEffect, useRef, useState } from "react";
import { money, tickMoney } from "./format";

const HEIGHT = 300;
const PAD = { left: 72, right: 16, top: 16, bottom: 28 };

/** Whole-dollar-friendly ticks (milliunits) covering [min, max]; none when everything is zero. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === 0 && max === 0) return [];
  const range = (max - min) / 1000 || 1;
  const rough = range / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const f = rough / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag * 1000;
  const out: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= Math.ceil(max / step) * step + 1e-6; t += step) {
    out.push(Math.round(t));
  }
  return out;
}

export function NetWorthChart({ data }: { data: NetWorth }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const { months } = data;
  const nws = months.map((m) => m.net_worth);
  const lo = Math.min(0, ...nws);
  const hi = Math.max(0, ...months.map((m) => Math.max(m.assets, -m.debts)), ...nws);
  const ticks = niceTicks(lo, hi);
  const min = ticks.length ? Math.min(lo, ticks[0] as number) : 0;
  const max = ticks.length ? Math.max(hi, ticks[ticks.length - 1] as number) : 1;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min || 1)) * plotH;
  const col = plotW / Math.max(1, months.length);
  const cx = (i: number) => PAD.left + col * (i + 0.5);
  const bw = Math.min(col * 0.4, 40);
  const zero = y(0);
  const line = months.map((m, i) => `${i ? "L" : "M"}${cx(i)},${y(m.net_worth)}`).join(" ");
  const h = hover === null ? null : months[hover];

  return (
    <div className="nw-chart" ref={box} style={{ height: HEIGHT }}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Net worth by month">
        {ticks.map((t) => (
          <g key={t}>
            <line className="nw-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text
              className="nw-tick"
              x={PAD.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tickMoney(t)}
            </text>
          </g>
        ))}
        <line className="nw-zero" x1={PAD.left} x2={width - PAD.right} y1={zero} y2={zero} />
        {months.map((m, i) => (
          <g key={m.month}>
            <rect
              className="bar-debts"
              x={cx(i) - bw}
              width={bw}
              y={zero - (y(0) - y(Math.abs(m.debts)))}
              height={Math.max(0, y(0) - y(Math.abs(m.debts)))}
            />
            <rect
              className="bar-assets"
              x={cx(i)}
              width={bw}
              y={zero - (y(0) - y(m.assets))}
              height={Math.max(0, y(0) - y(m.assets))}
            />
            <text className="nw-tick" x={cx(i)} y={HEIGHT - 8} textAnchor="middle">
              {shortMonthLabel(m.month)}
            </text>
          </g>
        ))}
        <path className="nw-line" d={line} fill="none" />
        {months.map((m, i) => (
          <circle key={m.month} className="nw-marker" cx={cx(i)} cy={y(m.net_worth)} r={4} />
        ))}
        {months.map((m, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only hover; the table below carries the same figures
          <rect
            key={m.month}
            className="nw-hover"
            data-month={m.month}
            x={PAD.left + col * i}
            y={PAD.top}
            width={col}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {h && hover !== null && (
        <div
          className="nw-tooltip"
          role="tooltip"
          style={{
            left: Math.min(cx(hover) + 12, width - 180),
            top: PAD.top,
          }}
        >
          <div className="nw-tip-month">{monthLabel(h.month)}</div>
          <div>
            <span className="swatch debts">●</span> Debts{" "}
            <strong>{money(Math.abs(h.debts))}</strong>
          </div>
          <div>
            <span className="swatch assets">●</span> Assets <strong>{money(h.assets)}</strong>
          </div>
          <div>
            <span className="swatch line">▬</span> Net Worth <strong>{money(h.net_worth)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
