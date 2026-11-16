import { aomTopTick, daysLabel } from "@budget/schema/age-of-money";
import { MONTH_NAMES, monthLabel } from "@budget/schema/report-range";
import type { AgeOfMoney } from "@budget/schema/reports";
import { useEffect, useRef, useState } from "react";

const HEIGHT = 320;
const PAD = { left: 72, right: 16, top: 16, bottom: 48 };

export function AgeOfMoneyChart({ months }: { months: AgeOfMoney["months"] }) {
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

  const n = months.length;
  const top = aomTopTick(Math.max(...months.map((m) => m.days)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const y = (d: number) => base - (d / top) * plotH;
  const col = plotW / n;
  const cx = (i: number) => PAD.left + col * (i + 0.5);
  const step = Math.max(1, Math.ceil(40 / col));
  const line = months.map((m, i) => `${i ? "L" : "M"}${cx(i)},${y(m.days)}`).join(" ");
  const area = `${line} L${cx(n - 1)},${base} L${cx(0)},${base} Z`;
  const h = hover === null ? null : months[hover];

  return (
    <div className="aom-chart" ref={box} style={{ height: HEIGHT }}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Age of Money by month">
        <line className="aom-grid" x1={PAD.left} x2={width - PAD.right} y1={PAD.top} y2={PAD.top} />
        <line
          className="aom-grid aom-base"
          x1={PAD.left}
          x2={width - PAD.right}
          y1={base}
          y2={base}
        />
        <text
          className="aom-ytick"
          x={PAD.left - 8}
          y={base}
          textAnchor="end"
          dominantBaseline="middle"
        >
          0 days
        </text>
        <text
          className="aom-ytick"
          x={PAD.left - 8}
          y={PAD.top}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {daysLabel(top)}
        </text>
        {n >= 2 && <path className="aom-area" d={area} />}
        <path className="aom-line" d={line} />
        {months.map((m, i) =>
          (n - 1 - i) % step === 0 ? (
            <text key={m.month} className="aom-xlabel" x={cx(i)} y={base + 18} textAnchor="middle">
              <tspan className="aom-xmonth" x={cx(i)}>
                {(MONTH_NAMES[Number(m.month.slice(5, 7)) - 1] ?? "").slice(0, 3)}
              </tspan>
              <tspan className="aom-xyear" x={cx(i)} dy="1.2em">
                {m.month.slice(0, 4)}
              </tspan>
            </text>
          ) : null,
        )}
        {hover !== null && (
          <line className="aom-guide" x1={cx(hover)} x2={cx(hover)} y1={PAD.top} y2={base} />
        )}
        {months.map((m, i) => (
          <circle
            key={m.month}
            className={`aom-marker${hover === i ? " selected" : ""}`}
            data-month={m.month}
            cx={cx(i)}
            cy={y(m.days)}
            r={4}
          />
        ))}
        {/* The hover column covers the plot from its top edge to the baseline, no more (EXF-621). */}
        {months.map((m, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only hover; the "Current" value and the API carry the figures
          <rect
            key={m.month}
            className="aom-hover"
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
          className="aom-tooltip"
          role="tooltip"
          style={{ left: cx(hover), top: y(h.days) + 12 }}
        >
          <span className="aom-tip-arrow" />
          <div className="aom-tip-month">{monthLabel(h.month)}</div>
          <div className="aom-tip-days">{daysLabel(h.days)}</div>
        </div>
      )}
    </div>
  );
}
