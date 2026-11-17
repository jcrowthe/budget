import { minusMoney, niceTicks } from "@budget/schema/reflect-format";
import { monthLabel, shortMonthLabel } from "@budget/schema/report-range";
import type { SpendingTrends } from "@budget/schema/reports";
import { useEffect, useRef, useState } from "react";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { money, percent, tickMoney } from "./format";

type Series = SpendingTrends["series"][number];

const HEIGHT = 320;
const PLOT_TOP = 24;
const PLOT_H = 266;
const RIGHT = 5;

interface Tip {
  lines: [string, string, string];
  x: number;
  y: number;
}

/** Stacked bars by series (rank order from zero up), net inflows below zero, and a line through the month totals. */
export function TrendsChart({
  data,
  onPick,
}: {
  data: SpendingTrends;
  onPick: (series: Series, month: string, x: number, y: number) => void;
}) {
  const fmt = usePlanFormatter();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const { months } = data;
  const rankOf = new Map(data.series.map((s, i) => [s.id, i]));
  const up = months.map((m) => m.series.reduce((n, s) => n + Math.max(s.amount, 0), 0));
  const down = months.map((m) => m.series.reduce((n, s) => n + Math.min(s.amount, 0), 0));
  const totals = months.map((m) => m.total);
  const lo = Math.min(0, ...down, ...totals);
  const hi = Math.max(0, ...up, ...totals);
  const ticks = niceTicks(lo, hi);
  // All zero: the zero line sits at mid-height (source: the empty chart).
  const min = ticks.length ? Math.min(lo, ticks[0] as number) : -1000;
  const max = ticks.length ? Math.max(hi, ticks[ticks.length - 1] as number) : 1000;
  // No y ticks: the plot starts 31px in (source, Designer S1).
  const left = ticks.length ? 72 : 31;
  const plotW = width - left - RIGHT;
  const y = (v: number) => PLOT_TOP + PLOT_H - ((v - min) / (max - min || 1)) * PLOT_H;
  const col = plotW / Math.max(1, months.length);
  const cx = (i: number) => left + col * (i + 0.5);
  const bw = Math.min(col * 0.5, 48);
  const axisY = PLOT_TOP + PLOT_H;
  const line = months.map((m, i) => `${i ? "L" : "M"}${cx(i)},${y(m.total)}`).join(" ");
  const fill = (rank: number) => `var(${rank < 8 ? `--sb-slice-${rank + 1}` : "--sb-slice-other"})`;

  const showTip = (lines: Tip["lines"], x: number, top: number) => setTip({ lines, x, y: top });
  const showMarkerTip = (m: (typeof months)[number], i: number) =>
    showTip([monthLabel(m.month), minusMoney(m.total, fmt), "Total Spending"], cx(i), y(m.total));
  const seriesOf = (id: string, fallback: { id: string; name: string }) =>
    data.series.find((d) => d.id === id) ?? { ...fallback, total: 0 };
  // The marker is drawn over the bars, so a click on it goes to the segment of its month under the pointer.
  const pickUnder = (month: string, x: number, px: number) => {
    const seg = document
      .elementsFromPoint(x, px)
      .find((el) => el.classList.contains("st-seg") && el.getAttribute("data-month") === month);
    const id = seg?.getAttribute("data-series");
    if (!seg || !id) return;
    setTip(null);
    onPick(seriesOf(id, { id, name: id }), month, x, px);
  };

  return (
    <div className="st-chart" ref={box} style={{ height: HEIGHT }}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Spending by month">
        {ticks.map((t) => (
          <g key={t}>
            <line className="st-grid" x1={left} x2={width - RIGHT} y1={y(t)} y2={y(t)} />
            <text
              className="st-tick"
              x={left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tickMoney(t, fmt)}
            </text>
          </g>
        ))}
        <line className="st-grid st-zero" x1={left} x2={width - RIGHT} y1={y(0)} y2={y(0)} />
        <line className="st-grid" x1={left} x2={width - RIGHT} y1={axisY} y2={axisY} />
        {/* Hover circles sit under the bars, so a click on a segment is never taken by a marker. */}
        {months.map((m, i) => (
          <g key={m.month}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: hover target of the marker; the table holds the same figures */}
            <circle
              className="st-hit"
              cx={cx(i)}
              cy={y(m.total)}
              r={10}
              onMouseEnter={() => showMarkerTip(m, i)}
              onMouseLeave={() => setTip(null)}
            />
          </g>
        ))}
        {months.map((m, i) => {
          let pos = 0;
          let neg = 0;
          return (
            <g key={m.month}>
              <line className="st-xtick" x1={cx(i)} x2={cx(i)} y1={axisY} y2={axisY + 6} />
              <text className="st-xlabel" x={cx(i)} y={axisY + 18} textAnchor="middle">
                {shortMonthLabel(m.month)}
              </text>
              {m.series.map((s) => {
                const from = s.amount > 0 ? pos : neg;
                const to = from + s.amount;
                if (s.amount > 0) pos = to;
                else neg = to;
                const top = Math.min(y(from), y(to));
                const series = seriesOf(s.id, s);
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: chart segments; the table holds the same figures
                  <rect
                    key={s.id}
                    className="st-seg"
                    data-month={m.month}
                    data-series={s.id}
                    x={cx(i) - bw / 2}
                    width={bw}
                    y={top}
                    height={Math.max(0, Math.abs(y(from) - y(to)))}
                    fill={fill(rankOf.get(s.id) ?? 0)}
                    onMouseEnter={() =>
                      showTip(
                        [
                          s.name,
                          s.amount < 0 ? minusMoney(s.amount, fmt) : money(s.amount, fmt),
                          s.amount < 0 ? "Net Inflows" : `${percent(s.share_pct ?? 0)} of Total`,
                        ],
                        cx(i),
                        top,
                      )
                    }
                    onMouseLeave={() => setTip(null)}
                    onClick={(e) => {
                      setTip(null);
                      onPick(series, m.month, e.clientX, e.clientY);
                    }}
                  />
                );
              })}
            </g>
          );
        })}
        <path className="st-line" d={line} />
        {months.map((m, i) => (
          <g key={m.month}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the visible marker takes the pointer over the bars; the table holds the same figures */}
            <circle
              className="st-marker"
              data-month={m.month}
              cx={cx(i)}
              cy={y(m.total)}
              r={5}
              onMouseEnter={() => showMarkerTip(m, i)}
              onMouseLeave={() => setTip(null)}
              onClick={(e) => pickUnder(m.month, e.clientX, e.clientY)}
            />
          </g>
        ))}
      </svg>
      {tip && (
        <div className="st-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="st-tip-name">{tip.lines[0]}</div>
          <div className="st-tip-amount">{tip.lines[1]}</div>
          <div className="st-tip-note">{tip.lines[2]}</div>
        </div>
      )}
    </div>
  );
}
