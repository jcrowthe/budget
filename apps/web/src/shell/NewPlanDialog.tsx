import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useCreateBudget } from "../api/budgets";

export function NewPlanDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const create = useCreateBudget();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const budget = await create.mutateAsync({ name });
    onClose();
    navigate(`/${budget.id}/budget`);
  }

  return (
    <div className="dialog-backdrop">
      <form className="dialog" role="dialog" aria-label="New Plan" onSubmit={submit}>
        <div className="dialog-head">
          <h2>New Plan</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          className="field"
          aria-label="Plan name"
          placeholder="Plan name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {create.error ? <p className="error">{create.error.message}</p> : null}
        <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
          Create Plan
        </button>
      </form>
    </div>
  );
}
