import { reconcileSentence } from "@budget/schema/reconcile";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useReconcile } from "../account/ReconcileContext";
import { setClearedKey } from "../api/transactions";

/** The bar over the table in reconcile mode: the live difference, Cancel and the finishing button. */
export function ReconcileBar() {
  const rc = useReconcile();
  // The figures are not final while a clear is on its way or the account is being read again (EXF-724).
  const budgetId = rc?.account.budget_id ?? "";
  const clearing = useIsMutating({ mutationKey: setClearedKey(budgetId) }) > 0;
  const reading = useIsFetching({ queryKey: ["accounts", budgetId, rc?.account.id] }) > 0;
  const stale = clearing || reading;
  if (!rc || rc.step !== "mode" || rc.statement === undefined) return null;
  const difference = rc.statement - rc.account.cleared_balance;
  return (
    <section className="reconcile-bar" aria-label="Reconciliation">
      <p className="reconcile-text">{reconcileSentence(difference)}</p>
      {rc.error && (
        <p className="reconcile-bar-error" role="alert">
          {rc.error}
        </p>
      )}
      <div className="reconcile-bar-buttons">
        <button type="button" className="secondary" onClick={rc.cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={rc.pending || stale}
          onClick={() => rc.finish(difference !== 0)}
        >
          {difference === 0 ? "Finish Reconciliation" : "Create Adjustment & Finish"}
        </button>
      </div>
    </section>
  );
}
