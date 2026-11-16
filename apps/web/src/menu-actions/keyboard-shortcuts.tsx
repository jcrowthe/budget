import type { PlanMenuAction } from "../shell/planMenuEntries";
import { KeyboardShortcutsDialog } from "../shortcuts/KeyboardShortcutsDialog";

export const action: PlanMenuAction = {
  entry: "keyboard-shortcuts",
  Dialog: KeyboardShortcutsDialog,
};
