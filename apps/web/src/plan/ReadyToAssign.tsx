import type { Month } from "@budget/core/month";
import { useEffect, useRef, useState } from "react";
import { useMonth } from "../api/months";
import { useMoveMoney } from "../api/moves";
import { AssignPopover } from "./AssignPopover";
import { FixThisPopover } from "./FixThisPopover";
import { money } from "./format";
import { CheckCircleFillIcon, InfoCircleFillIcon } from "./icons";
import { CaretDownIcon } from "./monthNavIcons";
import { RtaBreakdown } from "./RtaBreakdown";

type Open = "breakdown" | "assign" | "fix" | null;

/** The Ready to Assign box of the Plan header: three states by the sign of the month's Ready to Assign. */
export function ReadyToAssign({ budgetId, month }: { budgetId: string; month: Month }) {
  const detail = useMonth(budgetId, month).data;
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a popover closes when the month changes
  useEffect(() => setOpen(null), [month]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const fail = useRef("");
  const move = useMoveMoney(budgetId, () => setNotice(fail.current));

  if (!detail) return <div className="rta-box" />;
  const rta = detail.ready_to_assign;
  const state = rta > 0 ? "positive" : rta < 0 ? "negative" : "zero";
  const label =
    state === "positive"
      ? "Ready to Assign"
      : state === "zero"
        ? "All Money Assigned"
        : "You assigned more than you have";
  const close = () => setOpen(null);
  return (
    <div className="rta-wrap">
      <div ref={box} className={`rta-box is-${state}`}>
        <button
          ref={summary}
          type="button"
          className="rta-summary"
          aria-label="View Ready to Assign Breakdown"
          aria-haspopup="dialog"
          aria-expanded={open === "breakdown"}
          onClick={() => setOpen((o) => (o === "breakdown" ? null : "breakdown"))}
        >
          <span className="rta-amount">
            {money(rta)}
            <InfoCircleFillIcon className="rta-info" width={16} height={16} />
          </span>
          <span className="rta-label">{label}</span>
        </button>
        {state === "positive" && (
          <button
            ref={button}
            type="button"
            className="rta-button is-positive"
            aria-haspopup="dialog"
            aria-expanded={open === "assign"}
            onClick={() => setOpen("assign")}
          >
            Assign
            <CaretDownIcon />
          </button>
        )}
        {state === "negative" && (
          <button
            ref={button}
            type="button"
            className="rta-button is-negative"
            aria-haspopup="dialog"
            aria-expanded={open === "fix"}
            onClick={() => setOpen("fix")}
          >
            Fix This
          </button>
        )}
        {state === "zero" && (
          <button type="button" className="rta-check" disabled aria-label="All Money Assigned">
            <CheckCircleFillIcon width={30} height={30} />
          </button>
        )}
      </div>
      {notice && (
        <div className="rta-notice" role="alert">
          {notice}
        </div>
      )}
      {open === "breakdown" && box.current && (
        <RtaBreakdown
          detail={detail}
          anchor={box.current}
          alignTo={summary.current ?? undefined}
          onClose={close}
        />
      )}
      {open === "assign" && button.current && (
        <AssignPopover
          detail={detail}
          month={month}
          anchor={button.current}
          onClose={close}
          move={(m) => {
            fail.current = "Couldn't assign the money.";
            return move(m);
          }}
        />
      )}
      {open === "fix" && button.current && (
        <FixThisPopover
          detail={detail}
          budgetId={budgetId}
          month={month}
          anchor={button.current}
          onClose={close}
          move={(m) => {
            fail.current = "Couldn't un-assign the money.";
            return move(m);
          }}
        />
      )}
    </div>
  );
}
