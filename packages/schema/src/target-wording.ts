import type { MonthCategoryDetail } from "./months";
import { DEFAULT_FORMATTER, type PlanFormatter } from "./plan-formats";
import type { CategoryTargetMonth, TargetBehavior } from "./targets";

// Every string a category's target shows, in one pure module (no React, no clock). The wording is the
// specification's (EXF-508, EXF-514); target-wording.test.ts lists each string with the state that makes it.

export type TargetCategory = Pick<
  MonthCategoryDetail,
  "carried" | "assigned" | "activity" | "available"
> & { target: CategoryTargetMonth | null };

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parts = (iso: string) => ({
  y: iso.slice(0, 4),
  m: Number(iso.slice(5, 7)) - 1,
  d: Number(iso.slice(8, 10)),
});
/** "Oct 31 2027" */
const shortDate = (iso: string) => {
  const { y, m, d } = parts(iso);
  return `${(MONTHS[m] ?? "").slice(0, 3)} ${d} ${y}`;
};
/** "Apr 2027" */
const shortMonth = (iso: string) => {
  const { y, m } = parts(iso);
  return `${(MONTHS[m] ?? "").slice(0, 3)} ${y}`;
};
/** "December 31st" */
const longDay = (iso: string) => {
  const { m, d } = parts(iso);
  return `${MONTHS[m]} ${ordinal(d)}`;
};
/** "October of 2027" */
const monthOfYear = (iso: string) => {
  const { y, m } = parts(iso);
  return `${MONTHS[m]} of ${y}`;
};

/** The pill's title when no target speaks (moved here from the grid's format module). */
export const pillTitle = (available: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string => {
  if (available > 0) {
    return `${fmt.money(available)} Available to plan your spending—or click to move it to another category!`;
  }
  if (available < 0) {
    return `${fmt.money(available)} A green category is a happy category. Make this category happy by adding funds from surplus categories.`;
  }
  return "";
};

export const SNOOZE_LABEL = "Snooze target for this month";
export const SNOOZE_TIP_TITLE = "Snooze Target";
export const SNOOZE_TIP_BODY =
  "When you snooze a Target, Budget will treat the category as if it didn't have a Target (which means the category won't show as underfunded). At the start of next month, your Target will reactivate, well-rested and in a very good mood!";
export const SNOOZE_ONLY_CURRENT = "You can only snooze targets in the current month.";
export const SNOOZE_KEYBOARD_TIP = "Keyboard Tip: Press shift Z to snooze a category's target";

const isPeriodic = (t: CategoryTargetMonth) =>
  t.definition.cadence === "weekly" || t.definition.cadence === "monthly";
const isBalance = (t: CategoryTargetMonth) =>
  t.definition.cadence === "custom" && t.definition.behavior === "balance";
const dueDate = (t: CategoryTargetMonth) => t.period_due_date ?? t.definition.due_date ?? "";

export function targetStatusText(
  c: TargetCategory,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { amount: string | null; text: string } | null {
  const t = c.target;
  if (!t || t.status === "snoozed" || c.available < 0) return null;
  const spent = c.activity < 0 ? -c.activity : 0;
  const spentText =
    spent > 0 ? `. Spent ${fmt.money(spent)} of ${fmt.money(c.carried + c.assigned)}` : "";
  switch (t.status) {
    case "funded":
    case "complete":
      return { amount: null, text: `Funded${spentText}` };
    case "on_track":
      return { amount: null, text: `On Track${spentText}` };
    case "eventually":
      return {
        amount: fmt.money(t.overall_to_go),
        text: ` ${t.funded > 0 ? "more " : ""}needed eventually`,
      };
    default: {
      const more = t.definition.behavior === "set_aside" || t.funded > 0 ? "more " : "";
      let when = "this month";
      if (t.definition.cadence === "monthly" && t.period_due_date) {
        when = `by the ${ordinal(parts(t.period_due_date).d)}`;
      } else if (!isPeriodic(t) && t.due_this_month && t.period_due_date) {
        when = `by ${longDay(t.period_due_date)}`;
      }
      return { amount: fmt.money(t.to_go_this_month), text: ` ${more}needed ${when}` };
    }
  }
}

export function targetPill(
  c: TargetCategory,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): {
  tone: "zero" | "positive" | "negative" | "cautious";
  icon: "clock" | "check" | "clockCheck" | "snooze" | null;
  title: string;
} {
  const plainTone = c.available === 0 ? "zero" : c.available > 0 ? "positive" : "negative";
  const plain = { tone: plainTone, icon: null, title: pillTitle(c.available, fmt) } as const;
  const t = c.target;
  if (t?.status === "snoozed") {
    return {
      tone: plainTone,
      icon: c.available < 0 ? null : "snooze",
      title: pillTitle(c.available, fmt),
    };
  }
  if (!t || t.status === "eventually" || c.available < 0) return plain;
  const def = t.definition;
  const T = fmt.money(def.amount);
  const grey = c.available === 0;
  const toGo = fmt.money(t.to_go_this_month);
  if (t.status === "underfunded") {
    let title: string;
    if (isPeriodic(t)) {
      title = `Assign ${toGo} more to fund your ${fmt.money(t.needed_this_month)} monthly target.`;
    } else if (t.due_this_month) {
      title = `Your ${T} target is due this month, and you're short by ${toGo}. Assign another ${toGo} to fund your target.`;
    } else if (isBalance(t)) {
      title = `Assign ${toGo} more to stay on track towards reaching your ${T} target.`;
    } else {
      title = `Assign ${toGo} more to stay on track towards funding your ${T} target.`;
    }
    return { tone: "cautious", icon: "clock", title };
  }
  if (t.status === "on_track") {
    const verb = isBalance(t) ? "reach" : "fund";
    return {
      tone: grey ? "zero" : "positive",
      icon: grey ? null : "clockCheck",
      title: `You're on track to ${verb} your ${T} target by ${monthOfYear(dueDate(t))}.`,
    };
  }
  const title = isPeriodic(t)
    ? `You've funded your ${fmt.money(t.needed_this_month)} target for the month!`
    : `You've funded your ${T} target!`;
  return { tone: grey ? "zero" : "positive", icon: grey ? null : "check", title };
}

export function targetHeading(
  t: CategoryTargetMonth,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { heading: string; subheading: string } {
  const def = t.definition;
  const T = fmt.money(def.amount);
  const each = { weekly: "Week", monthly: "Month", yearly: "Year", custom: "" }[def.cadence];
  if (def.cadence === "custom") {
    if (def.behavior === "balance") {
      return {
        heading: `Have a Balance of ${T}`,
        subheading: def.due_month ? `By ${shortMonth(def.due_month)}` : "Eventually",
      };
    }
    const base = def.behavior === "fill_up" ? `Fill Up to ${T}` : `Set Aside Another ${T}`;
    const r = def.repeat;
    const every = r
      ? ` Every ${r.every === 1 ? "" : `${r.every} `}${r.unit === "year" ? "Year" : "Month"}${r.every === 1 ? "" : "s"}`
      : "";
    return { heading: `${base}${every}`, subheading: `By ${shortDate(dueDate(t))}` };
  }
  const heading =
    def.behavior === "refill"
      ? `Refill Up to ${T} Each ${each}`
      : `Set Aside Another ${T} Each ${each}`;
  let subheading: string;
  if (def.cadence === "weekly") subheading = `By ${WEEKDAYS[def.day_of_week ?? 0]}`;
  else if (def.cadence === "monthly") {
    subheading =
      def.day_of_month === null
        ? "By the End of the Month"
        : `By the ${ordinal(def.day_of_month)} of the Month`;
  } else subheading = `By ${shortDate(dueDate(t))}`;
  return { heading, subheading };
}

export function targetMessage(
  c: TargetCategory,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { tone: "cautious" | "positive"; text: string; assign: number | null } | null {
  const t = c.target;
  if (!t) return null;
  if (t.status === "funded") {
    return { tone: "positive", text: "You've met your target!", assign: null };
  }
  if (t.status === "on_track") {
    return { tone: "positive", text: "You're on track to meet your target!", assign: null };
  }
  if (t.status !== "underfunded") return null;
  const toGo = fmt.money(t.to_go_this_month);
  const text = isPeriodic(t)
    ? `Assign ${toGo} ${t.funded > 0 ? "more " : ""}to meet your target`
    : `Assign ${toGo} ${c.assigned > 0 ? "more " : ""}this month to stay on track`;
  return { tone: "cautious", text, assign: t.to_go_this_month };
}

export function targetDonut(c: TargetCategory): number | null {
  const t = c.target;
  if (!t || t.status === "complete" || t.status === "snoozed") return null;
  if (t.status === "funded" && isPeriodic(t)) return null;
  return t.percent;
}

export function targetBreakdown(
  c: TargetCategory,
): { label: string; amount: number; rule: boolean }[] {
  const t = c.target;
  if (!t) return [];
  const def = t.definition;
  const row = (label: string, amount: number, rule = false) => ({ label, amount, rule });
  if (isPeriodic(t)) {
    return def.behavior === "refill"
      ? [
          row("Needed This Month", t.needed_this_month),
          row("Funded", t.funded),
          row("To Go", t.to_go_this_month, true),
        ]
      : [
          row("Amount to Assign This Month", t.amount_this_month),
          row("Assigned So Far", t.funded),
          row("To Go", t.to_go_this_month, true),
        ];
  }
  if (isBalance(t)) {
    return [
      row(
        def.due_month ? `Balance Needed by ${shortMonth(def.due_month)}` : "Balance Needed",
        def.amount,
      ),
      row("Current Balance", t.funded),
      row("To Go", t.overall_to_go, true),
    ];
  }
  if (def.behavior === "set_aside") {
    return [
      row(`Total to Assign by ${shortDate(dueDate(t))}`, def.amount),
      row("Assigned So Far", t.funded),
      row("To Go", t.overall_to_go, true),
    ];
  }
  return [
    row(`Needed by ${shortDate(dueDate(t))}`, def.amount),
    row("Funded", t.funded),
    row("To Go", t.overall_to_go, true),
  ];
}

export const targetEmptyText = (name: string): { question: string; body: string } => ({
  question: `How much do you need for ${name}?`,
  body: "When you create a target, we’ll let you know how much money to set aside to stay on track over time.",
});

export type FormTab = "weekly" | "monthly" | "yearly" | "custom";

export function behaviorOptions(
  tab: FormTab,
  amount: number,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): {
  value: TargetBehavior;
  title: string;
  use: string;
  tagline: string | null;
  badge: string | null;
}[] {
  const X = fmt.money(amount);
  if (tab === "custom") {
    return [
      {
        value: "set_aside",
        title: `Set aside ${X}`,
        use: "Use for: bills, subscriptions, saving over time",
        tagline: `Add ${X} to this category, regardless of its current balance.`,
        badge: null,
      },
      {
        value: "fill_up",
        title: `Fill up to ${X}`,
        use: "Use for: gasoline, fun money, dining out",
        tagline: `Use what is already in this category and fill it up to ${X}.`,
        badge: null,
      },
      {
        value: "balance",
        title: `Have a balance of ${X}`,
        use: "Use for: long-term savings",
        tagline:
          "Reach this amount by a specific time and refrain from spending until you reach it.",
        badge: null,
      },
    ];
  }
  const shown = tab === "weekly" ? `${X}/week` : X;
  const refillHelp =
    tab === "weekly"
      ? `Sets a Target to have ${shown} on hand each month. Whatever you don't spend will get applied towards next month.`
      : tab === "yearly"
        ? `Sets a Target to have ${shown} on hand each year. Whatever you don't spend will get applied toward next year's ${shown}.`
        : `Sets a Target to have ${shown} on hand each month. Whatever you don't spend will get applied toward next month's ${shown}.`;
  return [
    {
      value: "set_aside",
      title: `Set aside another ${shown}`,
      use: "Use for: bills, subscriptions, saving over time",
      tagline: null,
      badge: "Most people choose this",
    },
    {
      value: "refill",
      title: `Refill up to ${shown}`,
      use: "Use for: gasoline, fun money, dining out",
      tagline: refillHelp,
      badge: null,
    },
  ];
}
