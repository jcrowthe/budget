import type { BankConnection } from "@budget/schema/bank-connections";
import { CheckCircleIcon } from "./icons";
import { usePlanFormatter } from "./plan-formats-context";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain confirmation after a link. EXF-461 replaces it with account selection. */
export function BankConnected({ connection }: { connection: BankConnection }) {
  const fmt = usePlanFormatter();
  return (
    <div className="bank-connected">
      <CheckCircleIcon />
      <h3>{connection.institution_name}</h3>
      <p>ID: {connection.display_id}</p>
      <h4>Bank accounts</h4>
      <ul>
        {connection.accounts.map((a) => (
          <li key={a.id}>
            <div className="bank-account-main">
              <span>{a.name}</span>
              <span>{a.current_balance === null ? "—" : fmt.money(a.current_balance)}</span>
            </div>
            <div className="bank-account-sub">
              {cap(a.subtype ?? a.type)}
              {a.mask ? ` ending in ${a.mask}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
