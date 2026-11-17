import { ManageConnectionsDialog } from "../shell/manage-connections-dialog";
import type { PlanMenuAction } from "../shell/planMenuEntries";

export const action: PlanMenuAction = {
  entry: "bank-connections",
  Dialog: ManageConnectionsDialog,
};
