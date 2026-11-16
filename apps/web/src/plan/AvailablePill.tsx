import type { Ref } from "react";
import { money, pillTitle } from "./format";
import { CheckCircleFillIcon, ClockCheckIcon, ClockIcon } from "./icons";

export type PillTone = "zero" | "positive" | "negative" | "cautious";
export type PillIcon = "clock" | "check" | "clockCheck" | null;

const ICONS = { clock: ClockIcon, check: CheckCircleFillIcon, clockCheck: ClockCheckIcon };

/**
 * A positive pill opens Move and a negative one Cover (`onOpen`); zero pills are disabled. A target gives it a
 * `tone`, an `icon` and a `title` (see target-wording.ts); without one it is the plain pill.
 */
export function AvailablePill({
  amount,
  interactive = true,
  display = false,
  onOpen,
  tone,
  icon = null,
  title,
  ref,
}: {
  amount: number;
  interactive?: boolean;
  /** A plain span with the pill's look (no title: the source's inspector pill has none), for the inspector. */
  display?: boolean;
  onOpen?: (anchor: HTMLButtonElement) => void;
  tone?: PillTone;
  icon?: PillIcon;
  title?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const kind = tone ?? (amount === 0 ? "zero" : amount > 0 ? "positive" : "negative");
  const Icon = icon ? ICONS[icon] : null;
  const content = (
    <>
      {Icon && <Icon className="pill-icon" width={14} height={14} data-icon={icon} />}
      {money(amount)}
    </>
  );
  if (display) {
    return <span className={`available-pill ${kind}`}>{content}</span>;
  }
  return (
    <button
      ref={ref}
      type="button"
      className={`available-pill ${kind}`}
      disabled={amount === 0 || !interactive}
      onClick={(e) => onOpen?.(e.currentTarget)}
      title={interactive ? (title ?? pillTitle(amount)) || undefined : undefined}
    >
      {content}
    </button>
  );
}
