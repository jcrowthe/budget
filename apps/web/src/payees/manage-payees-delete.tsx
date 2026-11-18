import { compareNames, type Payee, usingSentence } from "@budget/schema/payees";
import { useMemo, useState } from "react";

/** The inline `New payee` section of a delete: where the transactions of the payees go. */
export function NewPayeeSection({
  count,
  options,
  pending,
  several,
  onCancel,
  onDelete,
}: {
  count: number;
  options: Payee[];
  pending: boolean;
  several: boolean;
  onCancel: () => void;
  onDelete: (replacementId: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const sorted = useMemo(() => [...options].sort(compareNames), [options]);
  return (
    <section className="mp-new-payee" aria-label="New payee section">
      <h3>New payee</h3>
      <em className="mp-using">{usingSentence(count)}</em>
      <select
        className="mp-select"
        aria-label="New payee"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">[No Payee]</option>
        {sorted.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="mp-buttons mp-left">
        <button type="button" className="mp-button secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="mp-button destructive"
          disabled={pending}
          onClick={() => onDelete(value === "" ? null : value)}
        >
          {pending ? "Deleting..." : several ? "Delete All" : "Delete"}
        </button>
      </div>
    </section>
  );
}
