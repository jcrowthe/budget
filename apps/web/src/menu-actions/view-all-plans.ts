import type { PlanMenuAction } from "../shell/planMenuEntries";

export const action: PlanMenuAction = {
  entry: "view-all-plans",
  run: ({ navigate }) => navigate("/plans"),
};
