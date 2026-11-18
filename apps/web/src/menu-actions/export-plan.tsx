import { PlanExportDialog } from "../plan-export/plan-export-dialog";
import type { PlanMenuAction } from "../shell/planMenuEntries";

export const action: PlanMenuAction = { entry: "export-plan", Dialog: PlanExportDialog };
