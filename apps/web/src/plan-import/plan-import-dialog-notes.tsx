import { monthLabel } from "@budget/schema/plan-export";
import type { PlanFormatter } from "@budget/schema/plan-formats";
import type { ImportSummary } from "@budget/schema/plan-import";

const COUNTS: [keyof ImportSummary["counts"], string][] = [
  ["accounts", "Accounts"],
  ["groups", "Category groups"],
  ["categories", "Categories"],
  ["months", "Months"],
  ["transactions", "Transactions"],
  ["splits", "Splits"],
  ["transfers_paired", "Transfers paired"],
  ["scheduled", "Scheduled"],
];

export function Counts({ counts }: { counts: ImportSummary["counts"] }) {
  return (
    <section className="plan-import-dialog-section">
      <h3>Counts</h3>
      <dl className="plan-import-dialog-counts">
        {COUNTS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{counts[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The warnings and the mismatches of a summary, each list with its total when the server cut it. */
export function Notes({ summary, fmt }: { summary: ImportSummary; fmt: PlanFormatter }) {
  return (
    <>
      {summary.warnings.length > 0 ? (
        <section className="plan-import-dialog-section">
          <h3>Warnings</h3>
          <ul className="plan-import-dialog-list">
            {summary.warnings.map((w) => (
              <li key={`${w.code}:${w.message}`}>
                {w.message}
                {w.count > 1 ? ` ×${w.count}` : ""}
              </li>
            ))}
          </ul>
          {summary.warning_count > summary.warnings.length ? (
            <p className="plan-import-dialog-more">
              Showing {summary.warnings.length} of {summary.warning_count}
            </p>
          ) : null}
        </section>
      ) : null}
      {summary.mismatches.length > 0 ? (
        <section className="plan-import-dialog-section">
          <h3>Mismatches</h3>
          <ul className="plan-import-dialog-list">
            {summary.mismatches.map((m) => (
              <li key={`${m.category}:${m.month}:${m.column}`}>
                {m.category} · {monthLabel(m.month)} ·{" "}
                {m.column === "activity" ? "Activity" : "Available"} · expected{" "}
                {fmt.money(m.expected)} · got {fmt.money(m.got)}
              </li>
            ))}
          </ul>
          {summary.mismatch_count > summary.mismatches.length ? (
            <p className="plan-import-dialog-more">
              Showing {summary.mismatches.length} of {summary.mismatch_count}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
