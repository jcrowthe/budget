import { drillTitle, minusMoney } from "@budget/schema/reflect-format";
import { type MonthSpan, monthLabel } from "@budget/schema/report-range";
import type { IncomeExpense, ReportFigures } from "@budget/schema/reports";
import { type ReactNode, useState } from "react";
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
  const units = c + 5;
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
          {label}
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
            {label}
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
    <div className="ie-scroll">
      <table className="ie-table" style={{ minWidth: 96 + 64 * (c + 2) }}>
        <colgroup>
          {/* Source: flex 3 0 96px for the first column, flex 1 0 64px for the others (Designer I1). */}
          <col style={{ width: `calc(96px + ${3 / units} * (100% - ${96 + 64 * (c + 2)}px))` }} />
          {[...data.months, "average", "total"].map((k) => (
            <col
              key={k}
              style={{ width: `calc(64px + ${1 / units} * (100% - ${96 + 64 * (c + 2)}px))` }}
            />
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
