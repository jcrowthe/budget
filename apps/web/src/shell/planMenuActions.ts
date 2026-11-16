import { collectPlanMenuActions, type PlanMenuActionModule } from "./planMenuEntries";

/** Every `menu-actions/*` file registers one entry; an entry with an action is enabled. */
export const planMenuActions = collectPlanMenuActions(
  import.meta.glob<PlanMenuActionModule>("../menu-actions/*.{ts,tsx}", { eager: true }),
);
