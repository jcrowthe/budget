import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useCreateBudget } from "../api/budgets";

export function NewPlanDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const create = useCreateBudget();
  const navigate = useNavigate();

  function submit(e: FormEvent) {
    e.preventDefault();
    // Errors are shown through create.error, so there is nothing to catch here.
    create.mutate(
      { name },
      {
        onSuccess: (budget) => {
          onClose();
          navigate(`/${budget.id}/budget`);
        },
      },
    );
  }

  return (
    <div className="dialog-backdrop">
      <form className="dialog form" role="dialog" aria-label="New Plan" onSubmit={submit}>
        <div className="dialog-head">
          <h2>New Plan</h2>
        </div>
        <div className="form-body">
          <label htmlFor="new-plan-name">Plan Name</label>
          {/* biome-ignore lint/a11y/noAutofocus: the source focuses the field when the dialog opens */}
          <input
            id="new-plan-name"
            className="field"
            // biome-ignore lint/a11y/noAutofocus: see above
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {create.error ? <p className="error">{create.error.message}</p> : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
            Create Plan
          </button>
        </div>
      </form>
    </div>
  );
}
