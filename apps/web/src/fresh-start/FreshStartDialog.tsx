import { PLAN_NAME_TAKEN, planNameTaken } from "@budget/schema/fresh-start";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useBudgets } from "../api/budgets";
import { ApiError } from "../api/client";
import { localToday } from "../api/today";
import { CloseIcon } from "../shell/icons";
import { freshStart } from "./api";
import "./fresh-start.css";

const TOOLTIP =
  "If you plan to actively use both your Fresh Start plan and this archived plan, you may want to un-check this checkbox.";

const InfoIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="4.8" r="0.9" fill="currentColor" />
  </svg>
);

/**
 * Make a Fresh Start (EXF-478): a new plan with the structure of this one, starting today. Escape, Cancel and the
 * close button discard. Not undoable (docs/fresh-start-design.md).
 */
export function FreshStartDialog({
  budgetId,
  onClose,
}: {
  budgetId: string | null;
  onClose: () => void;
}) {
  const budgets = useBudgets();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [stop, setStop] = useState(true);
  const [tipOpen, setTipOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const tipId = useId();

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const clash = planNameTaken(
    (budgets.data ?? []).map((b) => b.name),
    name,
  );
  const empty = name.trim() === "";
  const shownError = clash ? PLAN_NAME_TAKEN : nameError;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!budgetId || empty || clash || pending) return;
    setPending(true);
    setServerError(null);
    setNameError(null);
    try {
      const done = await freshStart(budgetId, {
        name: name.trim(),
        stop_importing_in_archive: stop,
        today: localToday(),
      });
      await qc.invalidateQueries({ queryKey: ["budgets"] });
      onClose();
      navigate(`/${done.new_budget_id}/budget`);
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.status === 422) setNameError(err.message);
      else setServerError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form fresh-start-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fresh-start-title"
        noValidate
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h2 id="fresh-start-title">Make a Fresh Start</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="form-body">
          <p>
            Starting fresh will let you start planning from today without having to set up a brand
            new plan.
          </p>
          <p className="fresh-start-lead">Here's what you'll see in your Fresh Start:</p>
          <ul>
            <li>All your accounts. Linked accounts remain linked in the Fresh Start</li>
            <li>
              Today's balance for your linked accounts. Unlinked accounts will start with a $0
              balance for you to update with today's balance
            </li>
            <li>Today's transactions in linked accounts</li>
            <li>Scheduled transactions</li>
            <li>Your category groups, categories, and targets</li>
          </ul>
          <p className="fresh-start-lead">Your archived plan will retain:</p>
          <ul>
            <li>Transaction histories for your accounts</li>
            <li>Category amounts</li>
          </ul>
          <label htmlFor="fresh-start-name">New Plan Name</label>
          <input
            id="fresh-start-name"
            ref={nameRef}
            className="field"
            maxLength={100}
            autoComplete="off"
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? "fresh-start-name-error" : "fresh-start-name-hint"}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          {shownError ? (
            <p id="fresh-start-name-error" className="error">
              {shownError}
            </p>
          ) : (
            <p id="fresh-start-name-hint" className="fresh-start-hint">
              Don't worry - you can always edit it later.
            </p>
          )}
          <div className="fresh-start-stop">
            <label className="fresh-start-check">
              <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} />
              <span>Stop importing transactions in my archived plan</span>
            </label>
            <span className="fresh-start-tip-anchor">
              <button
                type="button"
                className="fresh-start-info"
                aria-label="More about stopping imports"
                aria-describedby={tipOpen ? tipId : undefined}
                onMouseEnter={() => setTipOpen(true)}
                onMouseLeave={() => setTipOpen(false)}
                onFocus={() => setTipOpen(true)}
                onBlur={() => setTipOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && tipOpen) {
                    e.stopPropagation();
                    setTipOpen(false);
                  }
                }}
              >
                <InfoIcon />
              </button>
              {tipOpen ? (
                <span id={tipId} role="tooltip" className="fresh-start-tooltip">
                  {TOOLTIP}
                </span>
              ) : null}
            </span>
          </div>
          <p className="fresh-start-hint">
            A copy of this plan will be archived in case you're not happy with the changes.
          </p>
          {serverError ? (
            <p className="error" role="alert">
              {serverError}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={empty || clash || pending}>
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
