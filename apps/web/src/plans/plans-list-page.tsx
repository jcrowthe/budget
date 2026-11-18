import type { Budget } from "@budget/schema/budgets";
import { useRef, useState } from "react";
import { useBudgets } from "../api/budgets";
import { PlanImportDialog } from "../plan-import/plan-import-dialog";
import { ImportPlanIcon } from "../plan-import/plan-import-dialog-icon";
import { PlusCircleIcon } from "../shell/icons";
import { NewPlanDialog } from "../shell/NewPlanDialog";
import { recentOtherPlans, useDocumentTitle } from "../shell/useCurrentPlan";
import { PlansListCard } from "./plans-list-card";
import { DeletePlanDialog } from "./plans-list-delete";
import "./plans-list.css";

/** `/plans`: every plan, the most recently used first, with Create New Plan. Reads the shell's one plans query. */
export function PlansListPage() {
  useDocumentTitle("Open Plan");
  const { data, isLoading, error } = useBudgets();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const [importing, setImporting] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  if (isLoading) return null;
  if (error) return <div className="card">Could not load plans.</div>;
  const plans = data ?? [];
  const now = Date.now();
  const ordered = recentOtherPlans(plans, undefined, plans.length);
  return (
    <section className="plans-list" aria-labelledby="plans-list-heading">
      <h1 id="plans-list-heading">Your Plans</h1>
      <ul className="plans-list-grid" aria-label="Plans">
        {ordered.map((p) => (
          <PlansListCard
            key={p.id}
            plan={p}
            now={now}
            onDelete={(plan, t) => {
              trigger.current = t;
              setDeleting(plan);
            }}
          />
        ))}
        <li>
          <button
            type="button"
            ref={createRef}
            className="plans-list-create"
            onClick={() => setCreating(true)}
          >
            <PlusCircleIcon />
            <span>Create New Plan</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            ref={importRef}
            className="plans-list-create plan-import-dialog-open"
            onClick={() => setImporting(true)}
          >
            <ImportPlanIcon />
            <span>Import Plan</span>
          </button>
        </li>
      </ul>
      {importing ? (
        <PlanImportDialog onClose={() => setImporting(false)} returnTo={() => importRef.current} />
      ) : null}
      {creating ? (
        <NewPlanDialog
          onClose={() => {
            setCreating(false);
            queueMicrotask(() => createRef.current?.focus());
          }}
        />
      ) : null}
      {deleting ? (
        <DeletePlanDialog
          plan={deleting}
          onClose={() => {
            setDeleting(null);
            queueMicrotask(() => trigger.current?.focus());
          }}
          onDeleted={() => {
            setDeleting(null);
            queueMicrotask(() => createRef.current?.focus());
          }}
        />
      ) : null}
    </section>
  );
}
