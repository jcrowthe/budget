import { type ReactNode, useState } from "react";
import { EditFlagsDialog } from "./EditFlagsDialog";

/** Edit Flags opened from a flag menu: `open()` shows the dialog, `dialog` is what to render. */
export function useEditFlagsDialog(budgetId: string | null): {
  open: () => void;
  dialog: ReactNode;
} {
  const [shown, setShown] = useState(false);
  return {
    open: () => setShown(true),
    dialog: shown ? <EditFlagsDialog budgetId={budgetId} onClose={() => setShown(false)} /> : null,
  };
}
