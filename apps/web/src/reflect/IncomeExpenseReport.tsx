import { drillTitle, minusMoney } from "@budget/schema/reflect-format";
import { type MonthSpan, monthLabel } from "@budget/schema/report-range";
import type { IncomeExpense, ReportFigures } from "@budget/schema/reports";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type ReportTransactionSelector, useIncomeExpense } from "../api/reports";
import { changeClass } from "./format";
import { CaretDownIcon, CaretRightIcon } from "./icons";
import { useReportState } from "./state";
import { TransactionPopover } from "./TransactionPopover";
import "./income-expense.css";

interface PopoverState {
  title: string;
  selector: ReportTransactionSelector;
  span: MonthSpan;
  excludedCategoryIds?: string[];
  x: number;
  y: number;
}

type Open = (p: PopoverState) => void;

const FIRST_MIN = 96; // source: first column flex 3 0 96px
const AMOUNT_MIN = 64; // source: other columns flex 1 0 64px
const AMOUNT_PAD = 25; // an amount cell's 8px left + 16px right padding + 1px border
const CARET = 16; // a toggle's 8px icon + 8px gap

interface IeWidths {
  first: number;
  other: number;
  table: number;
}

/**
 * Column widths: the source's flex arithmetic, with minimums measured from the content (EXF-625, EXF-626).
 * `width` is the box's clientWidth, `n` the amount columns, `amountNeed` the widest amount in px. The first column never grows past the source's flex share for its labels:
 * long labels are shortened with an ellipsis (source at 760px: first 170px, label scrollWidth 217 / clientWidth 169).
 */
function ieWidths(width: number, n: number, amountNeed: number): IeWidths {
  const units = n + 3;
  const spare = Math.max(0, width - (FIRST_MIN + AMOUNT_MIN * n));
  const f0 = FIRST_MIN + (3 / units) * spare;
  const o0 = AMOUNT_MIN + spare / units;
  const F = FIRST_MIN;
  const A = Math.max(AMOUNT_MIN, Math.ceil(amountNeed));
  let first = f0;
  let other = o0;
  if (f0 < F || o0 < A) {
    if (F + n * A <= width) {
      first = Math.max(F, Math.min(f0, width - n * A));
      other = (width - first) / n;
    } else {
      // Whole columns fill the visible part; the rest scrolls, so the box's edge falls between two cells.
      first = F;
      const k = Math.floor((width - F) / A);
      other = k >= 1 ? (width - F) / k : A;
    }
  }
  return { first, other, table: first + n * other };
}

const textWidth = (el: Element) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r.getBoundingClientRect().width;
};

/** One row's amount cells: a button per month, then Average and Total. */
function Cells({
  label,
  figures,
  months,
  span,
  selector,
  excludedCategoryIds,
  open,
  tone,
}: {
  label: string;
  figures: ReportFigures;
  months: string[];
  span: MonthSpan;
  selector?: ReportTransactionSelector;
  excludedCategoryIds?: string[];
  open: Open;
  /** Net Income colours by sign; other rows are grey at zero only. */
  tone?: "net";
}) {
  const cell = (value: number, column: string, month: string | null, i: number) => {
    const cls = Math.abs(value) < 5 ? "zero" : tone ? changeClass(value) : "";
    return (
      <td key={column} className={`ie-amt${i === 0 ? " ie-first-amt" : ""}`}>
        {selector ? (
          <button
            type="button"
            className="ie-btn"
            aria-label={`${label}–${column}`}
            onClick={(e) =>
              open({
                title: drillTitle(label, month),
                selector,
                span: month ? { start_month: month, end_month: month } : span,
                excludedCategoryIds,
                x: e.clientX,
                y: e.clientY,
              })
            }
          >
            <span className={`amt ${cls}`}>{minusMoney(value)}</span>
          </button>
        ) : (
          <span className={`amt ${cls}`}>{minusMoney(value)}</span>
        )}
      </td>
    );
  };
  return (
    <>
      {figures.months.map((v, i) =>
        cell(v, monthLabel(months[i] as string).toUpperCase(), months[i] as string, i),
      )}
      {cell(figures.average, "AVERAGE", null, 1)}
      {cell(figures.total, "TOTAL", null, 1)}
    </>
  );
}

export function IncomeExpenseReport() {
  const { budgetId, span, settings, today } = useReportState();
  const { data, isError } = useIncomeExpense(
    budgetId,
    span,
    settings.excluded_category_ids,
    settings.excluded_account_ids,
    today,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [popover, setPopover] = useState<PopoverState | null>(null);
  if (!data)
    return isError ? <p className="sb-popover-note">The report could not be loaded.</p> : null;
  return (
    <>
      <Table
        data={data}
        span={span}
        collapsed={collapsed}
        excluded={settings.excluded_category_ids}
        toggle={(key) =>
          setCollapsed((s) => {
            const next = new Set(s);
            if (!next.delete(key)) next.add(key);
            return next;
          })
        }
        open={setPopover}
      />
      {popover && <TransactionPopover {...popover} onClose={() => setPopover(null)} />}
    </>
  );
}

function Table({
  data,
  span,
  collapsed,
  excluded,
  toggle,
  open,
}: {
  data: IncomeExpense;
  span: MonthSpan;
  collapsed: Set<string>;
  excluded: string[];
  toggle: (key: string) => void;
  open: Open;
}) {
  const c = data.months.length;
  // Chrome drops a px+% calc() on a <col> in a fixed table: measure the box and set px widths (Designer I1).
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // The widest amount as drawn whole, measured after render (text widths do not depend on the columns).
  const tableRef = useRef<HTMLTableElement>(null);
  const [needs, setNeeds] = useState({ amount: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the rows change
  useLayoutEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    const measure = () => {
      let amount = 0;
      for (const el of t.querySelectorAll("td.ie-amt .amt, thead th:not(.ie-first)")) {
        amount = Math.max(amount, textWidth(el) + AMOUNT_PAD);
      }
      amount = Math.ceil(amount);
      setNeeds((n) => (n.amount === amount ? n : { amount }));
    };
    measure();
    document.fonts?.ready.then(measure);
  }, [data, collapsed]);
  const w = ieWidths(width, c + 2, needs.amount);
  // A shortened label shows its full text on hover; a whole one shows no tooltip, as in the source (EXF-626).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check when widths or rows change
  useLayoutEffect(() => {
    for (const th of tableRef.current?.querySelectorAll<HTMLElement>("tbody th.ie-first") ?? []) {
      if (th.querySelector(".ie-sr")) continue;
      const el = th.querySelector<HTMLElement>(".ie-label") ?? th;
      if (el.scrollWidth > el.clientWidth) th.title = el.textContent ?? "";
      else th.removeAttribute("title");
    }
  }, [w.first, data, collapsed]);
  const empty = <td colSpan={c + 2} />;
  const cells = (
    label: string,
    f: ReportFigures,
    selector?: ReportTransactionSelector,
    cats?: boolean,
  ) => (
    <Cells
      label={label}
      figures={f}
      months={data.months}
      span={span}
      selector={selector}
      excludedCategoryIds={cats ? excluded : undefined}
      open={open}
    />
  );
  const heading = (key: string, label: string, cls: string): ReactNode => (
    <tr className={`ie-heading ${cls}`}>
      <th scope="row" className="ie-first">
        <button
          type="button"
          className="ie-toggle"
          aria-expanded={!collapsed.has(key)}
          onClick={() => toggle(key)}
        >
          {collapsed.has(key) ? <CaretRightIcon /> : <CaretDownIcon />}
          <span className="ie-label">{label}</span>
        </button>
      </th>
      <td colSpan={c + 2} />
    </tr>
  );
  const groupRow = (
    key: string,
    label: string,
    f: ReportFigures,
    selector: ReportTransactionSelector,
    cats: boolean,
  ) => {
    const shut = collapsed.has(key);
    return (
      <tr className="ie-group">
        <th scope="row" className="ie-first">
          <button
            type="button"
            className="ie-toggle"
            aria-expanded={!shut}
            onClick={() => toggle(key)}
          >
            <span className="ie-label">{label}</span>
            {shut ? <CaretRightIcon /> : <CaretDownIcon />}
          </button>
        </th>
        {shut ? cells(label, f, selector, cats) : empty}
      </tr>
    );
  };
  const item = (
    cls: string,
    label: string,
    f: ReportFigures,
    selector: ReportTransactionSelector,
    key: string,
  ) => (
    <tr key={key} className={`ie-item ${cls}`}>
      <th scope="row" className="ie-first">
        {label}
      </th>
      {cells(label, f, selector)}
    </tr>
  );
  const total = (
    cls: string,
    label: string,
    f: ReportFigures,
    selector: ReportTransactionSelector,
    cats: boolean,
  ) => (
    <tr className={`ie-total ${cls}`}>
      <th scope="row" className="ie-first">
        {label}
      </th>
      {cells(label, f, selector, cats)}
    </tr>
  );
  const spacer = (
    <tr className="ie-spacer">
      <td colSpan={c + 3} />
    </tr>
  );

  const { income, expense } = data;
  return (
    <div className="ie-scroll" ref={box}>
      <table className="ie-table" ref={tableRef} style={{ width: w.table }}>
        <colgroup>
          {/* The source's flex 3 0 96px / 1 0 64px arithmetic with measured minimums (Designer I1, EXF-625/626). */}
          <col style={{ width: w.first }} />
          {[...data.months, "average", "total"].map((k) => (
            <col key={k} style={{ width: w.other }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="ie-first">
              <span className="ie-sr">Category</span>
            </th>
            {data.months.map((m) => (
              <th scope="col" key={m}>
                {monthLabel(m).toUpperCase()}
              </th>
            ))}
            <th scope="col">AVERAGE</th>
            <th scope="col">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {spacer}
          {heading("income", "Income", "income")}
          {!collapsed.has("income") && (
            <>
              {income.payees.length > 0 &&
                groupRow("sources", "All Income Sources", income.total, { income: true }, false)}
              {income.payees.length > 0 && !collapsed.has("sources") && (
                <>
                  {income.payees.map((p) =>
                    item(
                      "payee",
                      p.name,
                      p,
                      { income_payee_id: p.payee_id ?? "none" },
                      p.payee_id ?? "none",
                    ),
                  )}
                  {total(
                    "group",
                    "Total All Income Sources",
                    income.total,
                    { income: true },
                    false,
                  )}
                </>
              )}
              {total("section", "Total Income", income.total, { income: true }, false)}
            </>
          )}
        </tbody>
        <tbody>
          {spacer}
          {heading("expense", "Expense", "expense")}
          {!collapsed.has("expense") && (
            <>
              {expense.uncategorized &&
                item(
                  "uncat",
                  "Uncategorized Transactions",
                  expense.uncategorized,
                  { uncategorized: true },
                  "uncat",
                )}
              {expense.groups.map((g) => (
                <GroupRows key={g.id}>
                  {groupRow(`g:${g.id}`, g.name, g.total, { group_id: g.id }, true)}
                  {!collapsed.has(`g:${g.id}`) && (
                    <>
                      {g.categories.map((cat) =>
                        item("cat", cat.name, cat, { category_id: cat.id }, cat.id),
                      )}
                      {total("group", `Total ${g.name}`, g.total, { group_id: g.id }, true)}
                    </>
                  )}
                </GroupRows>
              ))}
              {total("section", "Total Expenses", expense.total, { expenses: true }, true)}
            </>
          )}
        </tbody>
        <tbody>
          {spacer}
          <tr className="ie-heading net">
            <th scope="row" className="ie-first">
              Net Income
            </th>
            <td colSpan={c + 2} />
          </tr>
          <tr className="ie-net">
            <th scope="row" className="ie-first">
              <span className="ie-sr">Net Income by month</span>
            </th>
            <Cells
              label="Net Income"
              figures={data.net_income}
              months={data.months}
              span={span}
              open={open}
              tone="net"
            />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const GroupRows = ({ children }: { children: ReactNode }) => <>{children}</>;
