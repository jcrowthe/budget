import { daysLabel } from "@budget/schema/age-of-money";
import { useId } from "react";
import { useAgeOfMoney } from "../api/reports";
import { AgeOfMoneyChart } from "./AgeOfMoneyChart";
import { useReportState } from "./state";
import "./age-of-money.css";

export function AgeOfMoneyReport() {
  const { budgetId, today } = useReportState();
  const { data } = useAgeOfMoney(budgetId, today);
  const headingId = useId();
  return (
    <div className="aom-report">
      <section className="aom-card" aria-label="Age of Money chart">
        <div className="aom-top">
          <div className="aom-current">
            <div className="aom-current-title">Current</div>
            <div className="aom-current-value" data-testid="aom-current">
              {data ? (data.current_days === null ? "—" : daysLabel(data.current_days)) : ""}
            </div>
          </div>
        </div>
        {data &&
          (data.months.length ? (
            <AgeOfMoneyChart months={data.months} />
          ) : (
            <div className="aom-empty-area">
              <div className="aom-empty" role="status">
                <h2 className="aom-empty-title">Spend more money!</h2>
                <p>
                  Strange advice, we know. Budget needs a minimum of 10 transactions to calculate
                  your Age of Money.
                </p>
              </div>
            </div>
          ))}
      </section>
      <section className="aom-info" aria-labelledby={headingId}>
        <h2 id={headingId}>Understanding Age of Money</h2>
        <div className="aom-info-content">
          <p>
            Age of Money is how long, on average, money sits in your account(s) between earning and
            spending it.
          </p>
          <p>
            Want to have more time to make decisions? Tired of shifting money around at the last
            minute? Use Age of Money to help you gauge the time between earning and spending.
          </p>
        </div>
      </section>
    </div>
  );
}
