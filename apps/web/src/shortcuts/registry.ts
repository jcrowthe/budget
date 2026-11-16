// The shortcut registry: data only. Order and wording follow the Keyboard Shortcuts help, word for word.
export const THEN = { kind: "then" } as const;
export type Cap = string | typeof THEN;
export type SectionId = "universal" | "plan" | "account" | "date-picker";

export const SHORTCUT_SECTIONS: { id: SectionId; title: string }[] = [
  { id: "universal", title: "Universal" },
  { id: "plan", title: "Plan Actions" },
  { id: "account", title: "Account Actions" },
  { id: "date-picker", title: "Date Picker" },
];

type Row = {
  id: string;
  section: SectionId;
  description: string;
  caps: readonly Cap[];
  /** What can be dispatched; none for rows typed in a field or made of a click or a chord. */
  combos?: readonly string[];
};

const u = "universal";
const p = "plan";
const a = "account";
const d = "date-picker";

export const SHORTCUTS = [
  {
    id: "open-help",
    section: u,
    description: "Open Keyboard Shortcuts Help",
    caps: ["?"],
    combos: ["?"],
  },
  {
    id: "toggle-sidebar",
    section: u,
    description: "Expand/Collapse Sidebar",
    caps: ["shift", "."],
    combos: ["shift+."],
  },
  {
    id: "select-all",
    section: u,
    description: "Select All",
    caps: ["ctrl", "A"],
    combos: ["ctrl+a"],
  },
  {
    id: "deselect-all",
    section: u,
    description: "Deselect All",
    caps: ["escape"],
    combos: ["escape"],
  },
  { id: "math-operations", section: u, description: "Math operations", caps: ["+", "-", "x", "/"] },
  { id: "undo", section: u, description: "Undo", caps: ["ctrl", "Z"], combos: ["ctrl+z"] },
  {
    id: "redo",
    section: u,
    description: "Redo",
    caps: ["ctrl", "shift", "Z"],
    combos: ["ctrl+shift+z", "ctrl+y"],
  },

  {
    id: "snooze-target",
    section: p,
    description: "Snooze target",
    caps: ["shift", "Z"],
    combos: ["shift+z"],
  },
  {
    id: "toggle-groups",
    section: p,
    description: "Collapse/expand groups",
    caps: ["ctrl", "↑/↓"],
    combos: ["ctrl+arrowup", "ctrl+arrowdown"],
  },
  {
    id: "plan-move",
    section: p,
    description: "Move between plan rows",
    caps: ["↑/↓"],
    combos: ["arrowup", "arrowdown"],
  },
  {
    id: "plan-extend",
    section: p,
    description: "Select multiple categories",
    caps: ["shift", "↑/↓"],
    combos: ["shift+arrowup", "shift+arrowdown"],
  },

  {
    id: "add-transaction",
    section: a,
    description: "Add new transaction",
    caps: ["shift", "N"],
    combos: ["shift+n"],
  },
  { id: "approve", section: a, description: "Approve", caps: ["A"], combos: ["a"] },
  {
    id: "approve-all",
    section: a,
    description: "Approve all transactions",
    caps: ["shift", "L"],
    combos: ["shift+l"],
  },
  { id: "reject", section: a, description: "Reject", caps: ["shift", "R"], combos: ["shift+r"] },
  { id: "categorize", section: a, description: "Categorize", caps: ["K"], combos: ["k"] },
  { id: "split", section: a, description: "Split", caps: ["S"], combos: ["s"] },
  { id: "enter-now", section: a, description: "Enter Now", caps: ["E"], combos: ["e"] },
  { id: "match", section: a, description: "Match", caps: ["M"], combos: ["m"] },
  { id: "unmatch", section: a, description: "Unmatch", caps: ["shift", "U"], combos: ["shift+u"] },
  {
    id: "toggle-cleared",
    section: a,
    description: "Toggle cleared state",
    caps: ["C"],
    combos: ["c"],
  },
  {
    id: "duplicate",
    section: a,
    description: "Duplicate",
    caps: ["shift", "D"],
    combos: ["shift+d"],
  },
  { id: "flag", section: a, description: "Flag", caps: ["shift", "F", THEN, "0‑6"] },
  {
    id: "make-repeating",
    section: a,
    description: "Make repeating",
    caps: ["shift", "T"],
    combos: ["shift+t"],
  },
  {
    id: "delete",
    section: a,
    description: "Delete",
    caps: ["delete"],
    combos: ["delete", "backspace"],
  },
  {
    id: "reconcile",
    section: a,
    description: "Reconcile",
    caps: ["shift", "E"],
    combos: ["shift+e"],
  },
  {
    id: "focus-search",
    section: a,
    description: "Focus on the search bar",
    caps: ["ctrl", "shift", "F"],
    combos: ["ctrl+shift+f"],
  },
  {
    id: "select-group",
    section: a,
    description: "Select a group of transactions",
    caps: ["shift", "click"],
  },
  {
    id: "select-multiple",
    section: a,
    description: "Select multiple transactions",
    caps: ["shift", "↑/↓"],
    combos: ["shift+arrowup", "shift+arrowdown"],
  },
  {
    id: "move-transactions",
    section: a,
    description: "Move between transactions",
    caps: ["↑/↓"],
    combos: ["arrowup", "arrowdown"],
  },
  { id: "next-field", section: a, description: "Move to next transaction field", caps: ["tab"] },
  {
    id: "previous-field",
    section: a,
    description: "Move to previous transaction field",
    caps: ["shift", "tab"],
  },

  {
    id: "date-navigate",
    section: d,
    description: "Navigate the date picker",
    caps: ["↑", "↓", "←", "→"],
  },
  { id: "date-next-day", section: d, description: "Move date one day forward", caps: ["+"] },
  { id: "date-previous-day", section: d, description: "Move date one day backward", caps: ["-"] },
  { id: "date-today", section: d, description: "Select today", caps: ["T"] },
  { id: "date-month-start", section: d, description: "Select first day of month", caps: ["M"] },
  {
    id: "date-month-end",
    section: d,
    description: "Select last day of month",
    caps: ["shift", "M"],
  },
  { id: "date-year-start", section: d, description: "Select first day of year", caps: ["Y"] },
  { id: "date-year-end", section: d, description: "Select last day of year", caps: ["shift", "Y"] },
] as const satisfies readonly Row[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
export type Shortcut = {
  id: ShortcutId;
  section: SectionId;
  description: string;
  caps: readonly Cap[];
  combos?: readonly string[];
};

export function shortcutById(id: ShortcutId): Shortcut {
  const s = (SHORTCUTS as readonly Shortcut[]).find((x) => x.id === id);
  if (!s) throw new Error(`unknown shortcut ${id}`);
  return s;
}
