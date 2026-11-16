import type { Month } from "@budget/core/month";
import type { AutoAssignScope } from "../../api/autoAssign";
import { AutoAssignOptions } from "../AutoAssignOptions";
import { LightningIcon } from "../icons";
import { PanelCard } from "./PanelCard";

/** The Auto-Assign card of the right panel (collapsible), in all three panel states. */
export function AutoAssignCard({
  budgetId,
  month,
  scope,
  collapsed,
  onToggle,
  onViewAll,
}: {
  budgetId: string;
  month: Month;
  scope: AutoAssignScope;
  collapsed: boolean;
  onToggle: () => void;
  onViewAll: () => void;
}) {
  return (
    <PanelCard
      id="panel-auto-assign"
      title="Auto-Assign"
      collapsed={collapsed}
      onToggle={onToggle}
      iconFirst
      icon={<LightningIcon className="card-title-icon" />}
    >
      <AutoAssignOptions budgetId={budgetId} month={month} scope={scope} onViewAll={onViewAll} />
    </PanelCard>
  );
}
