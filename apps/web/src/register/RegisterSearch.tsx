import { parseSearch, type SearchToken } from "@budget/schema/transaction-search";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAccounts } from "../api/accounts";
import { useMonth } from "../api/months";
import { localToday } from "../api/today";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { CloseSmallIcon, SearchIcon } from "./icons";
import {
  appliedOf,
  type SearchCtx,
  type Suggestion,
  splitCurrent,
  suggestions,
  withChoice,
} from "./register-search";

const DEBOUNCE_MS = 250;

export type RegisterSearchState = {
  /** What the box shows. */
  text: string;
  /** The query the register sends: the readable tokens of `text`, "" for none. */
  applied: string;
  tokens: SearchToken[];
  setText: (text: string) => void;
  /** Writes `text` and applies it at once (a chosen suggestion). */
  choose: (text: string) => void;
  clear: () => void;
  input: React.RefObject<HTMLInputElement | null>;
};

/** Page state of the register search: not in the URL, not stored; `resetKey` (the account) clears it. */
export function useRegisterSearchState(resetKey: string): RegisterSearchState {
  const fmt = usePlanFormatter();
  const ctx = useMemo(
    () => ({ dateFormat: fmt.dateFormat, today: localToday() }),
    [fmt.dateFormat],
  );
  const [text, setTextState] = useState("");
  const [applied, setApplied] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = useCallback(() => clearTimeout(timer.current), []);
  const setText = useCallback(
    (t: string) => {
      setTextState(t);
      stop();
      timer.current = setTimeout(() => setApplied(appliedOf(t, ctx)), DEBOUNCE_MS);
    },
    [ctx, stop],
  );
  const choose = useCallback(
    (t: string) => {
      setTextState(t);
      stop();
      setApplied(appliedOf(t, ctx));
    },
    [ctx, stop],
  );
  const clear = useCallback(() => {
    setTextState("");
    stop();
    setApplied("");
    input.current?.focus();
  }, [stop]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new account starts without a search
  useEffect(() => {
    setTextState("");
    setApplied("");
    return stop;
  }, [resetKey]);
  const tokens = useMemo(() => parseSearch(applied, ctx).tokens, [applied, ctx]);
  return { text, applied, tokens, setText, choose, clear, input };
}

/** The toolbar's search box: a combobox whose list suggests tokens for the segment being typed. */
export function RegisterSearch({
  budgetId,
  name,
  search,
}: {
  budgetId: string;
  name: string;
  search: RegisterSearchState;
}) {
  const fmt = usePlanFormatter();
  const listId = useId();
  const today = localToday();
  const monthQ = useMonth(budgetId, `${today.slice(0, 7)}-01`);
  const accountsQ = useAccounts(budgetId);
  const { text, setText, choose, clear, input } = search;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ctx: SearchCtx = useMemo(
    () => ({
      dateFormat: fmt.dateFormat,
      today,
      money: fmt.money,
      date: fmt.date,
      parseDate: fmt.parseDate,
    }),
    [fmt, today],
  );
  const categories = useMemo(
    () => [
      "Ready to Assign",
      ...(monthQ.data?.groups ?? []).flatMap((g) => g.categories.map((c) => c.name)),
    ],
    [monthQ.data],
  );
  const accounts = useMemo(() => (accountsQ.data ?? []).map((a) => a.name), [accountsQ.data]);
  const current = splitCurrent(text).current;
  const items = useMemo(
    () => suggestions(current, ctx, categories, accounts),
    [current, ctx, categories, accounts],
  );
  const shown = open && items.length > 0;
  const pick = (s: Suggestion | undefined) => {
    if (!s || s.write === null) return;
    choose(withChoice(text, s.write));
    setOpen(false);
    setActive(-1);
    input.current?.focus();
    // The caret goes to the end of the new text once React has written it.
    requestAnimationFrame(() => {
      const el = input.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
  };
  const selectable = items.filter((s) => s.write !== null);
  const move = (by: number) => {
    const idx = items.flatMap((s, i) => (s.write === null ? [] : [i]));
    if (idx.length === 0) return;
    const pos = idx.indexOf(active);
    const next = pos < 0 ? (by > 0 ? 0 : idx.length - 1) : (pos + by + idx.length) % idx.length;
    setActive(idx[next] as number);
  };
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <span className="search-box">
      <SearchIcon />
      <input
        ref={input}
        type="search"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={`Search ${name}`}
        aria-label="Find the transactions you're looking for..."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (items.length === 0) return;
            e.preventDefault();
            setOpen(true);
            move(e.key === "ArrowDown" ? 1 : -1);
          } else if (e.key === "Enter") {
            if (!shown) return;
            e.preventDefault();
            pick(active >= 0 ? items[active] : selectable[0]);
          } else if (e.key === "Escape" && shown) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {text !== "" && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
        >
          <CloseSmallIcon />
        </button>
      )}
      {shown && (
        <div
          className="search-suggestions"
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
        >
          {items.map((s, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keyboard (aria-activedescendant)
            <div
              key={s.key}
              id={optionId(i)}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              aria-disabled={s.write === null}
              className={`search-option${i === active ? " is-active" : ""}${s.write === null ? " is-hint" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
            >
              <span className="search-option-label">{s.label}</span>
              <span className="search-option-description">{s.description}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
