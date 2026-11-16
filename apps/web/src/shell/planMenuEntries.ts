import type { ComponentType } from "react";

/** Entries a feature can switch on by registering an action (see docs/conventions.md, "Plan menu entries"). */
export const REGISTRABLE = [
  "new-plan",
  "plan-settings",
  "manage-payees",
  "edit-flags",
  "display-options",
  "export-plan",
  "fresh-start",
  "bank-connections",
  "keyboard-shortcuts",
  "view-all-plans",
] as const;
export type RegistrableEntryId = (typeof REGISTRABLE)[number];
export type BuiltInEntryId = "open-plan" | "log-out";
export type PlanMenuEntryId = RegistrableEntryId | BuiltInEntryId;

export type PlanMenuContext = { budgetId: string | null; navigate: (to: string) => void };
export type PlanMenuAction =
  | { entry: RegistrableEntryId; run: (ctx: PlanMenuContext) => void }
  | {
      entry: RegistrableEntryId;
      Dialog: ComponentType<{ budgetId: string | null; onClose: () => void }>;
    };
export type PlanMenuActionModule = { action?: PlanMenuAction };

export type IconKey =
  | "plus-circle"
  | "folder"
  | "wrench"
  | "arrows-circle"
  | "flag"
  | "paint-roller"
  | "document-down"
  | "leaf"
  | "bank"
  | "keyboard"
  | "logout"
  | "document";
export type EntryDef = { id: PlanMenuEntryId; label: string; icon: IconKey; needsPlan: boolean };
export type MenuSection = { heading: string | null; entries: EntryDef[] };

const e = (id: PlanMenuEntryId, label: string, icon: IconKey, needsPlan = false): EntryDef => ({
  id,
  label,
  icon,
  needsPlan,
});

export const PLAN_MENU: MenuSection[] = [
  {
    heading: null,
    entries: [e("new-plan", "New Plan", "plus-circle"), e("open-plan", "Open Plan", "folder")],
  },
  {
    heading: "Current Plan",
    entries: [
      e("plan-settings", "Plan Settings", "wrench", true),
      e("manage-payees", "Manage Payees", "arrows-circle", true),
      e("edit-flags", "Edit Flags", "flag", true),
      e("display-options", "Display Options", "paint-roller", true),
      e("export-plan", "Export Plan", "document-down", true),
      e("fresh-start", "Make a Fresh Start", "leaf", true),
    ],
  },
  {
    heading: "Account",
    entries: [
      e("bank-connections", "Manage Bank Connections", "bank", true),
      e("keyboard-shortcuts", "Keyboard Shortcuts", "keyboard"),
    ],
  },
  { heading: null, entries: [e("log-out", "Log Out", "logout")] },
];

export const VIEW_ALL_PLANS: EntryDef = e("view-all-plans", "View All Plans", "folder");

export function collectPlanMenuActions(
  mods: Record<string, PlanMenuActionModule>,
): Map<RegistrableEntryId, PlanMenuAction> {
  const out = new Map<RegistrableEntryId, PlanMenuAction>();
  const files = new Map<RegistrableEntryId, string>();
  for (const file of Object.keys(mods).sort()) {
    const action = mods[file]?.action;
    if (!action) continue;
    if (!(REGISTRABLE as readonly string[]).includes(action.entry))
      throw new Error(`plan menu: unknown entry ${action.entry} in ${file}`);
    if (out.has(action.entry))
      throw new Error(
        `plan menu: ${action.entry} registered twice (${files.get(action.entry)}, ${file})`,
      );
    out.set(action.entry, action);
    files.set(action.entry, file);
  }
  return out;
}

export type ResolvedEntry = EntryDef & { enabled: boolean; action?: PlanMenuAction };

export function resolveEntry(
  def: EntryDef,
  actions: Map<RegistrableEntryId, PlanMenuAction>,
  hasPlan: boolean,
): ResolvedEntry {
  if (def.id === "open-plan" || def.id === "log-out") return { ...def, enabled: true };
  const action = actions.get(def.id as RegistrableEntryId);
  return { ...def, action, enabled: !!action && (!def.needsPlan || hasPlan) };
}
