import type { Payee } from "@budget/schema/payees";
import {
  type PayeeRenameRule,
  RENAME_RULE_ERRORS,
  RENAME_RULE_TEXT_MAX,
  RENAMING,
  type RenameRuleKind,
} from "@budget/schema/rename-rules";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  applyRuleChange,
  createRenameRule,
  deleteRenameRule,
  updateRenameRule,
  usePayeeRenameRules,
} from "../api/payees";
import { GearIcon } from "./rename-rules-icons";

const detailOf = (e: unknown) =>
  e instanceof ApiError ? e.detail : "Something went wrong. Try again.";

const KINDS: { value: RenameRuleKind; label: string }[] = [
  { value: "contains", label: RENAMING.contains },
  { value: "is", label: RENAMING.is },
];

function KindSelect({
  value,
  disabled,
  onChange,
}: {
  value: RenameRuleKind;
  disabled: boolean;
  onChange: (k: RenameRuleKind) => void;
}) {
  return (
    <select
      className="mp-input mp-rule-kind"
      aria-label="Rule type"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as RenameRuleKind)}
    >
      {KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </select>
  );
}

/** The `Renaming` card: the payee's rules, one row each, and an empty row at the end. */
export function RenamingCard({
  budgetId,
  payee,
  disabled,
}: {
  budgetId: string;
  payee: Payee;
  disabled: boolean;
}) {
  const rules = usePayeeRenameRules(budgetId, payee.id).data ?? [];
  return (
    <div className="mp-card mp-rules">
      <h2 className="mp-rules-heading">
        <GearIcon />
        {RENAMING.title}
      </h2>
      <div className="mp-card-body">
        <p className="mp-rules-intro">{RENAMING.intro}</p>
        {rules.map((r) => (
          <RuleRow key={r.id} budgetId={budgetId} payeeId={payee.id} rule={r} disabled={disabled} />
        ))}
        <NewRuleRow budgetId={budgetId} payeeId={payee.id} disabled={disabled} />
      </div>
    </div>
  );
}

function RuleRow({
  budgetId,
  payeeId,
  rule,
  disabled,
}: {
  budgetId: string;
  payeeId: string;
  rule: PayeeRenameRule;
  disabled: boolean;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<RenameRuleKind>(rule.kind);
  const [draft, setDraft] = useState(rule.text);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const inflight = useRef(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(rule.text);
    setKind(rule.kind);
  }, [rule.text, rule.kind]);

  const replace = (saved: PayeeRenameRule) =>
    applyRuleChange(qc, budgetId, payeeId, (list) =>
      list.map((r) => (r.id === saved.id ? saved : r)),
    );
  const run = async (work: () => Promise<void>, revert?: () => void) => {
    if (inflight.current) return;
    inflight.current = true;
    setPending(true);
    try {
      await work();
      setError("");
    } catch (e) {
      setError(detailOf(e));
      revert?.();
    } finally {
      inflight.current = false;
      setPending(false);
    }
  };

  const saveKind = (k: RenameRuleKind) => {
    setKind(k);
    if (k === rule.kind) return;
    void run(
      async () => replace(await updateRenameRule(budgetId, payeeId, rule.id, { kind: k })),
      () => setKind(rule.kind),
    );
  };
  const saveText = () => {
    const text = draft.trim();
    if (text === rule.text) {
      setError("");
      setDraft(rule.text);
      return;
    }
    if (text === "") {
      setError(RENAME_RULE_ERRORS.empty);
      return;
    }
    void run(async () => {
      replace(await updateRenameRule(budgetId, payeeId, rule.id, { text }));
      setDraft(text);
    });
  };
  const remove = () =>
    void run(async () => {
      await deleteRenameRule(budgetId, payeeId, rule.id);
      applyRuleChange(qc, budgetId, payeeId, (list) => list.filter((r) => r.id !== rule.id));
    });

  const off = disabled || pending;
  return (
    <div className="mp-rule">
      <div className="mp-rule-row">
        <KindSelect value={kind} disabled={off} onChange={saveKind} />
        <input
          className="mp-input"
          aria-label="Rule text"
          value={draft}
          disabled={disabled}
          maxLength={RENAME_RULE_TEXT_MAX}
          data-dirty={draft !== rule.text ? "" : undefined}
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
            saveText();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveText();
            } else if (e.key === "Escape" && draft !== rule.text) {
              e.stopPropagation();
              setDraft(rule.text);
              setError("");
            }
          }}
        />
        <button
          type="button"
          className="mp-rule-button"
          title={RENAMING.remove}
          aria-label={RENAMING.remove}
          disabled={off}
          onMouseDown={(e) => e.preventDefault()}
          onClick={remove}
        >
          −
        </button>
      </div>
      {error ? (
        <div role="alert" className="mp-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function NewRuleRow({
  budgetId,
  payeeId,
  disabled,
}: {
  budgetId: string;
  payeeId: string;
  disabled: boolean;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<RenameRuleKind>("contains");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const inflight = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const add = async () => {
    const t = text.trim();
    if (t === "") {
      setError("");
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    setPending(true);
    try {
      const saved = await createRenameRule(budgetId, payeeId, { kind, text: t });
      applyRuleChange(qc, budgetId, payeeId, (list) => [...list, saved]);
      setText("");
      setError("");
    } catch (e) {
      setError(detailOf(e));
    } finally {
      inflight.current = false;
      setPending(false);
    }
  };
  const off = disabled || pending;
  return (
    <div className="mp-rule">
      <div className="mp-rule-row">
        <KindSelect value={kind} disabled={off} onChange={setKind} />
        <input
          ref={input}
          className="mp-input"
          aria-label="New rule text"
          value={text}
          disabled={disabled}
          data-dirty={text !== "" ? "" : undefined}
          maxLength={RENAME_RULE_TEXT_MAX}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          onBlur={() => void add()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            } else if (e.key === "Escape" && text !== "") {
              e.stopPropagation();
              setText("");
              setError("");
            }
          }}
        />
        <button
          type="button"
          className="mp-rule-button"
          title={RENAMING.add}
          aria-label={RENAMING.add}
          disabled={off}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (text.trim() === "" ? input.current?.focus() : void add())}
        >
          +
        </button>
      </div>
      {error ? (
        <div role="alert" className="mp-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
