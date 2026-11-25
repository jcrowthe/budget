import { COMBINE, type Payee } from "@budget/schema/payees";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { combinePayees, invalidatePayeeViews } from "../api/payees";

/**
 * Combine and Rename (EXF-512): the selected payees become one. The field starts as the first-selected payee's name.
 * The survivor is the selected payee whose name was typed, else the first-selected one (it keeps its categorization).
 */
export function CombineCard({
  budgetId,
  selected,
  onDone,
}: {
  budgetId: string;
  selected: Payee[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const first = selected[0] as Payee;
  const [draft, setDraft] = useState(first.name);
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState("");
  // A new first payee refills the field.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the first payee's id is the trigger
  useEffect(() => {
    setDraft(first.name);
    setFault("");
  }, [first.id]);

  const name = draft.trim();
  const press = async () => {
    if (name === "" || pending) return;
    const target = selected.find((p) => p.name === name) ?? first;
    setPending(true);
    setFault("");
    try {
      await combinePayees(budgetId, { ids: selected.map((p) => p.id), name, targetId: target.id });
      await invalidatePayeeViews(qc, budgetId);
      onDone();
    } catch (e) {
      setFault(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mp-card mp-combine">
      <h2>{COMBINE.title}</h2>
      <div className="mp-card-body">
        <p className="mp-combine-note">{COMBINE.note}</p>
        <div className="mp-combine-row">
          <input
            className="mp-input"
            aria-label={COMBINE.placeholder}
            placeholder={COMBINE.placeholder}
            value={draft}
            maxLength={200}
            onChange={(e) => {
              setDraft(e.target.value);
              setFault("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void press();
              }
            }}
          />
          <button
            type="button"
            className="mp-button mp-primary"
            disabled={name === "" || pending}
            onClick={() => void press()}
          >
            {COMBINE.button}
          </button>
        </div>
        {fault ? (
          <div role="alert" className="mp-error">
            {fault}
          </div>
        ) : null}
      </div>
    </section>
  );
}
