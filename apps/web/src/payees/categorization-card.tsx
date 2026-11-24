import type { Payee } from "@budget/schema/payees";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useMonth } from "../api/months";
import { savePayeeCategory } from "../api/payees";
import { localToday } from "../api/today";
import { CategoryField } from "../register/CategoryField";
import type { CategoryValue } from "../register/entryDraft";
import "../register/entry.css";
import { RecentPopover } from "./categorization-recent";

type Mode = Payee["category_mode"];

const detailOf = (e: unknown) =>
  e instanceof ApiError ? e.detail : "Something went wrong. Try again.";

/** The Manage Payees `Categorization` card: how the register fills this payee's category. Each choice saves at once. */
export function CategorizationCard({
  budgetId,
  payee,
  disabled,
}: {
  budgetId: string;
  payee: Payee;
  disabled: boolean;
}) {
  const qc = useQueryClient();
  const month = useMonth(budgetId, `${localToday().slice(0, 7)}-01`).data;
  const groups = month?.groups ?? [];
  // A credit card payment category belongs to its card: the picker does not offer it (the Worker refuses it too).
  const pickable = useMemo(
    () =>
      month && {
        ...month,
        groups: month.groups
          .filter((g) => g.kind !== "credit_card_payments")
          .map((g) => ({
            ...g,
            categories: g.categories.filter((c) => c.kind !== "credit_card_payment"),
          })),
      },
    [month],
  );
  const [choice, setChoice] = useState<Mode>(payee.category_mode);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const inflight = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLButtonElement>(null);
  // Another screen changed the mode: follow it.
  useEffect(() => setChoice(payee.category_mode), [payee.category_mode]);
  const history = payee.category_mode === "history";
  // The popover belongs to the history text: it goes when the mode leaves.
  useEffect(() => {
    if (!history) setOpen(false);
  }, [history]);

  const find = (id: string | null) => {
    for (const g of groups) {
      const c = g.categories.find((x) => x.id === id);
      if (c) return `${g.name}: ${c.name}`;
    }
    return null;
  };
  const fixedLive =
    payee.fixed_inflow_to_ready_to_assign ||
    (payee.fixed_category_id !== null && find(payee.fixed_category_id) !== null);
  const fixedValue: CategoryValue = payee.fixed_inflow_to_ready_to_assign
    ? { kind: "rta" }
    : payee.fixed_category_id
      ? { kind: "category", id: payee.fixed_category_id }
      : { kind: "none" };
  const current = payee.default_category_id
    ? find(payee.default_category_id)
    : payee.default_inflow_to_ready_to_assign
      ? "Ready to Assign"
      : "Not yet set";

  const save = async (body: Parameters<typeof savePayeeCategory>[3], keepChoice: boolean) => {
    if (inflight.current) return;
    inflight.current = true;
    setError("");
    try {
      await savePayeeCategory(qc, budgetId, payee.id, body);
    } catch (e) {
      setError(detailOf(e));
      if (!keepChoice) setChoice(payee.category_mode);
    } finally {
      inflight.current = false;
    }
  };

  const choose = (mode: Mode) => {
    if (inflight.current) return;
    setChoice(mode);
    setError("");
    if (mode === payee.category_mode) return;
    // Always use my choice: nothing is sent until a category is picked, unless a stored one is still live.
    if (mode === "fixed" && !fixedLive) return;
    void save({ category_mode: mode }, false);
  };

  const pick = (v: CategoryValue) => {
    if (v.kind === "none") return;
    void save(
      v.kind === "rta"
        ? {
            category_mode: "fixed",
            fixed_category_id: null,
            fixed_inflow_to_ready_to_assign: true,
          }
        : { category_mode: "fixed", fixed_category_id: v.id },
      true,
    );
  };

  const radio = (mode: Mode, label: string) => (
    <label className="mp-cat-option">
      <input
        type="radio"
        name={`mp-cat-${payee.id}`}
        checked={choice === mode}
        tabIndex={choice === mode ? undefined : -1}
        disabled={disabled}
        onChange={() => choose(mode)}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div ref={card} className="mp-card mp-categorization">
      <h2>Categorization</h2>
      <div className="mp-card-body">
        <div role="radiogroup" aria-label="Categorization">
          {radio("history", "Auto-categorize based on payee history")}
          {history ? (
            <div className="mp-cat-detail">
              <p>
                Budget will auto-select the category for new {payee.name} transactions based on how
                the{" "}
                <button
                  ref={link}
                  type="button"
                  className="mp-link"
                  aria-haspopup="dialog"
                  disabled={disabled}
                  data-dirty={open ? "" : undefined}
                  onClick={() => setOpen((o) => !o)}
                  onKeyDown={(e) => {
                    if (open && e.key === "Escape") {
                      e.stopPropagation();
                      setOpen(false);
                    }
                  }}
                >
                  last 3 transactions
                </button>{" "}
                for this payee were categorized. This is updated when you add or edit a transaction.
              </p>
              <p>
                Current default category: <strong>{current}</strong>
              </p>
            </div>
          ) : null}
          {radio("fixed", "Always use my choice")}
          {choice === "fixed" ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: Escape leaves the combobox for the radio
            <div
              className="mp-cat-detail mp-cat-field"
              onFocusCapture={(e) => {
                e.target.dataset.dirty = "";
              }}
              onBlurCapture={(e) => {
                delete e.target.dataset.dirty;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  card.current?.querySelector<HTMLElement>("input[type=radio]:checked")?.focus();
                }
              }}
            >
              <CategoryField
                month={pickable}
                value={fixedValue}
                disabled={disabled}
                footer="none"
                placeholder="category"
                onChange={pick}
              />
            </div>
          ) : null}
          {radio("off", `Do not auto-categorize ${payee.name}`)}
        </div>
        {error ? (
          <div role="alert" className="mp-error">
            {error}
          </div>
        ) : null}
      </div>
      {open && history && link.current ? (
        <RecentPopover
          budgetId={budgetId}
          payeeId={payee.id}
          anchor={link.current}
          onClose={() => {
            setOpen(false);
            if (link.current?.isConnected) link.current.focus();
          }}
        />
      ) : null}
    </div>
  );
}
