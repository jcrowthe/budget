import type { Ref } from "react";
import { money, pillTitle } from "./format";
import {
  CheckCircleFillIcon,
  ClockCheckIcon,
  ClockIcon,
  CreditCardIcon,
  SnoozeIcon,
} from "./icons";

export type PillTone = "zero" | "positive" | "negative" | "cautious";
export type PillIcon = "clock" | "check" | "clockCheck" | "snooze" | "card" | null;

const ICONS = {
  clock: ClockIcon,
  check: CheckCircleFillIcon,
  clockCheck: ClockCheckIcon,
  snooze: SnoozeIcon,
  card: CreditCardIcon,
};

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
  const cls = `available-pill ${kind}${icon === "card" ? " credit" : ""}`;
  const content = (
    <>
      {Icon && (
        <Icon
          className="pill-icon"
          width={icon === "card" ? 13 : 14}
          height={icon === "card" ? 13 : 14}
          data-icon={icon}
        />
      )}
      <span className="pill-amount">{money(amount)}</span>
    </>
  );
  if (display) {
    return <span className={cls}>{content}</span>;
  }
  return (
    <button
      ref={ref}
      type="button"
      className={cls}
      disabled={amount === 0 || !interactive}
      onClick={(e) => onOpen?.(e.currentTarget)}
      title={interactive ? (title ?? pillTitle(amount)) || undefined : undefined}
    >
      {content}
    </button>
  );
}
