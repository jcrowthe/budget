import type { AccountType } from "@budget/core/account-types";
import { ACCOUNT_TYPE_GROUPS, ACCOUNT_TYPE_LABEL } from "./accountTypeLabels";

export function AddAccountTypePicker({
  value,
  onPick,
}: {
  value: AccountType | null;
  onPick: (type: AccountType) => void;
}) {
  return (
    <div className="type-picker">
      {ACCOUNT_TYPE_GROUPS.map((g) => (
        <section key={g.heading} className="type-group">
          <h3>{g.heading}</h3>
          <p>{g.description}</p>
          {g.types.map((t) => (
            <button
              key={t}
              type="button"
              className="type-tile"
              aria-pressed={value === t}
              onClick={() => onPick(t)}
            >
              {ACCOUNT_TYPE_LABEL[t]}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
