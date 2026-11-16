import { NavLink, useParams } from "react-router";
import { reflectPath } from "../shell/planPaths";

export const TABS = [
  { slug: "spending-breakdown", label: "Spending Breakdown" },
  { slug: "spending-trends", label: "Spending Trends" },
  { slug: "net-worth", label: "Net Worth" },
  { slug: "income-expense", label: "Income v Expense" },
  { slug: "age-of-money", label: "Age of Money" },
] as const;

export function ReportTabs() {
  const { budgetId = "" } = useParams();
  return (
    <nav className="report-tabs" aria-label="Reports">
      {TABS.map((t) => (
        <NavLink key={t.slug} to={reflectPath(budgetId, t.slug)} className="report-tab">
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
