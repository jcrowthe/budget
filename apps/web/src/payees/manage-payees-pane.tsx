import {
  EMPTY_PICK,
  HIDDEN_NOTE,
  PAYEE_ERRORS,
  type Payee,
  paneMode,
  selectedLabel,
  showTransactionsLabel,
  TRANSFER_NOTE,
  usedCount,
} from "@budget/schema/payees";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { bulkPayees, deletePayee, invalidatePayeeViews, updatePayee } from "../api/payees";
import { NewPayeeSection } from "./manage-payees-delete";
import { PayeesIllustration } from "./manage-payees-illustration";

const detailOf = (e: unknown) =>
  e instanceof ApiError ? e.detail : "Something went wrong. Try again.";

/** The right pane: what the selection allows. */
export function EditPane({
  budgetId,
  selected,
  all,
  onShowTransactions,
  onDeselectTransfers,
  onClear,
  onOpenGroup,
}: {
  budgetId: string;
  selected: Payee[];
  all: Payee[];
  onShowTransactions: (payeeId: string, anchor: HTMLElement) => void;
  onDeselectTransfers: () => void;
  onClear: () => void;
  onOpenGroup: (g: "payees" | "hidden") => void;
}) {
  const qc = useQueryClient();
  const mode = paneMode(selected);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState("");
  const ids = selected.map((p) => p.id).join("\u0000");
  // A new selection closes an open delete question.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection's ids are the trigger
  useEffect(() => {
    setDeleting(false);
    setFault("");
  }, [ids]);

  const refresh = () => invalidatePayeeViews(qc, budgetId);
  const used = selected.reduce((n, p) => n + usedCount(p), 0);
  const options = all.filter(
    (p) => p.system === null && !p.transfer_account_id && !selected.some((s) => s.id === p.id),
  );

  const run = async (work: () => Promise<void>, after?: () => void) => {
    setPending(true);
    setFault("");
    try {
      await work();
      await refresh();
      after?.();
    } catch (e) {
      setFault(detailOf(e));
    } finally {
      setPending(false);
    }
  };
  const doDelete = (replacementId: string | null) =>
    run(
      async () => {
        const first = selected[0];
        if (selected.length === 1 && first) await deletePayee(budgetId, first.id, replacementId);
        else
          await bulkPayees(budgetId, {
            ids: selected.map((p) => p.id),
            action: "delete",
            replacementId,
          });
      },
      () => {
        setDeleting(false);
        onClear();
      },
    );

  if (mode === "none") {
    return (
      <div className="mp-empty">
        <PayeesIllustration />
        <p>{EMPTY_PICK}</p>
      </div>
    );
  }
  if (mode === "transfer") {
    const p = selected[0] as Payee;
    return (
      <div className="mp-pane">
        <h2 className="mp-heading">{p.name}</h2>
        <div className="mp-info">{TRANSFER_NOTE}</div>
      </div>
    );
  }
  if (mode === "mixed") {
    return (
      <div className="mp-pane">
        <p className="mp-mixed">
          Only one payee group can be edited at a time. Please{" "}
          <button type="button" className="mp-link" onClick={onDeselectTransfers}>
            deselect transfer payees
          </button>{" "}
          to continue.
        </p>
      </div>
    );
  }

  const several = mode === "several";
  const allHidden = selected.every((p) => p.hidden);
  const single = selected[0] as Payee;
  const section = deleting ? (
    <NewPayeeSection
      count={used}
      options={options}
      pending={pending}
      several={several}
      onCancel={() => setDeleting(false)}
      onDelete={doDelete}
    />
  ) : (
    <div className="mp-buttons mp-left">
      <button
        type="button"
        className="mp-button secondary"
        disabled={pending}
        onClick={() =>
          run(
            async () => {
              if (several)
                await bulkPayees(budgetId, {
                  ids: selected.map((p) => p.id),
                  action: allHidden ? "unhide" : "hide",
                });
              else await updatePayee(budgetId, single.id, { hidden: !single.hidden });
            },
            () => onOpenGroup(allHidden ? "payees" : "hidden"),
          )
        }
      >
        {several ? (allHidden ? "Unhide All" : "Hide All") : single.hidden ? "Unhide" : "Hide"}
      </button>
      <button
        type="button"
        className="mp-button destructive"
        disabled={pending}
        onClick={() => (used === 0 ? doDelete(null) : setDeleting(true))}
      >
        {several ? "Delete All" : "Delete"}
      </button>
    </div>
  );

  return (
    <div className={`mp-pane${deleting ? " mp-deleting" : ""}`}>
      {several ? (
        <SelectedNames selected={selected} />
      ) : (
        <NameCard
          key={single.id}
          budgetId={budgetId}
          payee={single}
          disabled={deleting}
          onSaved={refresh}
          onShow={(el) => onShowTransactions(single.id, el)}
        />
      )}
      {section}
      {fault ? (
        <div role="alert" className="mp-error mp-fault">
          {fault}
        </div>
      ) : null}
      {!deleting && !several ? <p className="mp-note">{HIDDEN_NOTE}</p> : null}
    </div>
  );
}

function SelectedNames({ selected }: { selected: Payee[] }) {
  return (
    <div className="mp-card">
      <h2>{selectedLabel(selected.length)}</h2>
      <div className="mp-card-body mp-names">
        {selected.map((p, i) => (
          <span key={p.id}>
            <span className="mp-selected-name" title={p.name}>
              {p.name}
            </span>
            {i < selected.length - 1 ? ", " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function NameCard({
  budgetId,
  payee,
  disabled,
  onSaved,
  onShow,
}: {
  budgetId: string;
  payee: Payee;
  disabled: boolean;
  onSaved: () => void;
  onShow: (anchor: HTMLElement) => void;
}) {
  const [draft, setDraft] = useState(payee.name);
  const [error, setError] = useState("");
  const inflight = useRef(false);
  const focused = useRef(false);
  const n = usedCount(payee);
  // Another screen renamed it: follow, unless the field is being typed in.
  useEffect(() => {
    if (!focused.current) setDraft(payee.name);
  }, [payee.name]);

  const save = async () => {
    const text = draft.trim();
    if (text === payee.name) {
      setError("");
      setDraft(payee.name);
      return;
    }
    if (text === "") {
      setError(PAYEE_ERRORS.empty);
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    try {
      await updatePayee(budgetId, payee.id, { name: text });
      setError("");
      setDraft(text);
      onSaved();
    } catch (e) {
      setError(detailOf(e));
    } finally {
      inflight.current = false;
    }
  };

  return (
    <div className="mp-card">
      <h2>Payee Name</h2>
      <div className="mp-card-body">
        <input
          className="mp-input"
          aria-label="Payee Name"
          value={draft}
          disabled={disabled}
          maxLength={200}
          data-dirty={draft !== payee.name ? "" : undefined}
          aria-invalid={error ? true : undefined}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          onBlur={() => {
            focused.current = false;
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape" && draft !== payee.name) {
              e.stopPropagation();
              setDraft(payee.name);
              setError("");
            }
          }}
        />
        {error ? (
          <div role="alert" className="mp-error">
            {error}
          </div>
        ) : null}
        <div className="mp-show">
          {n === 0 ? (
            <span className="mp-none">No Transactions</span>
          ) : (
            <button
              type="button"
              className="mp-button secondary"
              onClick={(e) => onShow(e.currentTarget)}
            >
              {showTransactionsLabel(n)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
