import { useState } from "react";
import { useShortcut, useShortcutDispatcher } from "./dispatcher";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

/** Mounted once in the shell: the app's key dispatcher, and the `?` dialog. */
export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  useShortcutDispatcher();
  useShortcut("open-help", () => setOpen(true));
  return open ? <KeyboardShortcutsDialog onClose={() => setOpen(false)} /> : null;
}
