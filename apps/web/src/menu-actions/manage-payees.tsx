import { ManagePayeesDialog } from "../payees/manage-payees-dialog";
import type { PlanMenuAction } from "../shell/planMenuEntries";

export const action: PlanMenuAction = { entry: "manage-payees", Dialog: ManagePayeesDialog };
