import { evaluateAssigned, formatAssignedInput } from "@budget/schema/assigned-edit";
import { useRef, useState } from "react";
import { amountClass, money } from "./format";
import { CalculatorIcon } from "./icons";

export type CloseHow = "enter" | "escape" | "tab" | "shiftTab" | "next" | "prev" | "blur";

/** Inert for now: the calculator popover is not built, and the icon must never take focus. */
export const Calculator = () => (
  <button
    type="button"
    className="calculator-button"
    tabIndex={-1}
    aria-hidden="true"
    onMouseDown={(e) => e.preventDefault()}
  >
    <CalculatorIcon />
  </button>
);

function AssignedInput({
  name,
  assigned,
  onClose,
  onCommit,
}: {
  name: string;
  assigned: number;
  onClose: (how: CloseHow, committed?: Promise<void>) => void;
  onCommit: (after: number) => Promise<void>;
}) {
  const [initial] = useState(() => formatAssignedInput(assigned));
  const [text, setText] = useState(initial);
  const done = useRef(false);

  const finish = (how: CloseHow, commit: boolean) => {
    if (done.current) return;
    done.current = true;
    let p: Promise<void> | undefined;
    if (commit && text !== initial) {
      const after = evaluateAssigned(text, assigned);
      if (after !== assigned) p = onCommit(after);
    }
    onClose(how, p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (
      "+-*/xX".includes(e.key) &&
      e.key.length === 1 &&
      el.selectionStart === 0 &&
      el.selectionEnd === el.value.length &&
      el.value.length > 0
    ) {
      el.setSelectionRange(el.value.length, el.value.length);
      return;
    }
    const act = (how: CloseHow, commit = true) => {
      e.preventDefault();
      finish(how, commit);
    };
    if (e.key === "Enter") act("enter");
    else if (e.key === "Escape") {
      e.stopPropagation();
      act("escape", false);
    } else if (e.key === "Tab") act(e.shiftKey ? "shiftTab" : "tab");
    else if (e.key === "ArrowDown") act("next");
    else if (e.key === "ArrowUp") act("prev");
  };

  return (
    <input
      ref={(el) => {
        if (el && document.activeElement !== el) {
          el.focus();
          el.select();
        }
      }}
      className="assigned-input"
      type="text"
      aria-label={`Assigned for ${name}`}
      autoComplete="off"
      spellCheck={false}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish("blur", true)}
    />
  );
}

export function AssignedCell({
  name,
  assigned,
  editing,
  onOpen,
  onClose,
  onCommit,
}: {
  name: string;
  assigned: number;
  editing: boolean;
  onOpen: () => void;
  onClose: (how: CloseHow, committed?: Promise<void>) => void;
  onCommit: (after: number) => Promise<void>;
}) {
  if (editing) {
    return (
      <div className="assigned-box is-editing">
        <Calculator />
        <AssignedInput name={name} assigned={assigned} onClose={onClose} onCommit={onCommit} />
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the amount button inside is the keyboard path; the box widens the click target
    // biome-ignore lint/a11y/useKeyWithClickEvents: same
    <div className="assigned-box" onClick={onOpen}>
      <Calculator />
      <button type="button" className={amountClass(assigned)}>
        {money(assigned)}
      </button>
    </div>
  );
}
