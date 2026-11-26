import type { Month } from "@budget/core/month";
import {
  overspentCount,
  PLAN_VIEWS,
  type PlanView,
  type ViewSelection,
  viewCategories,
} from "@budget/schema/plan-views";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import {
  chipOrder,
  useCreateView,
  useCustomViews,
  useDeleteView,
  useReorderViews,
  useUpdateView,
} from "../api/customViews";
import { useMonth } from "../api/months";
import { useEnterDueOnOpen } from "../api/scheduledTransactions";
import { KeyboardTip } from "../plan/KeyboardTip";
import { type EditRequest, PlanGrid } from "../plan/PlanGrid";
import { PlanHeader } from "../plan/PlanHeader";
import { PlanPanel } from "../plan/panel/PlanPanel";
import { usePlanLayout } from "../plan/panel/planLayout";
import { selectOnly, useSelection, visibleSelection } from "../plan/selection";
import { ViewChips } from "../plan/ViewChips";
import { CustomViewDialog } from "../plan/views/CustomViewDialog";
import { ManageViewsDialog } from "../plan/views/ManageViewsDialog";
import { localCurrentMonth, planPath, rememberMonth, usePlanMonth } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

/** Everything below the URL logic. Keyed by plan, so the selection and every open editor reset on a plan switch. */
function PlanContent({ budgetId, month }: { budgetId: string; month: Month }) {
  const [selection, setSelection] = useSelection();
  // EXF-541: a loan's page links here with the paired category to select, so its Target card (the Debt Payment
  // Target editor) is open in the inspector.
  const wanted = (useLocation().state as { selectCategory?: string } | null)?.selectCategory;
  // biome-ignore lint/correctness/useExhaustiveDependencies: applies the requested selection once, on arrival
  useEffect(() => {
    if (wanted) setSelection(() => selectOnly(wanted));
  }, [wanted]);
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const layout = usePlanLayout(bodyRef);
  const detail = useMonth(budgetId, month).data;
  // The chip in use is not saved: All after a reload or a plan switch, kept across months. A built-in key or a
  // custom view's id.
  const [viewKey, setViewKey] = useState<string>("all");
  const viewAll = () => setViewKey("all");
  const customViews = useCustomViews(budgetId).data;
  const custom = customViews?.views.find((v) => v.id === viewKey);
  const view: ViewSelection = custom
    ? { id: custom.id, name: custom.name, category_ids: custom.category_ids }
    : (PLAN_VIEWS as readonly string[]).includes(viewKey)
      ? (viewKey as PlanView)
      : "all";
  // Overspent leaves with its last category (not compared with the source).
  useEffect(() => {
    if (view === "overspent" && detail && overspentCount(detail) === 0) setViewKey("all");
  }, [view, detail]);
  // A custom view deleted elsewhere: back to All once the list has loaded without it.
  useEffect(() => {
    if (customViews && !custom && !(PLAN_VIEWS as readonly string[]).includes(viewKey))
      setViewKey("all");
  }, [customViews, custom, viewKey]);
  // Dialogs: the editor opens on its own (menu, toolbar) or over Manage Views (`from: "manage"`).
  const [manageOpen, setManageOpen] = useState(false);
  const [editor, setEditor] = useState<
    | { mode: "new"; from: "menu" | "manage" }
    | { mode: "edit"; id: string; from: "menu" | "manage" }
    | null
  >(null);
  const createView = useCreateView(budgetId);
  const updateView = useUpdateView(budgetId);
  const deleteView = useDeleteView(budgetId);
  const reorderViews = useReorderViews(budgetId);
  const editing =
    editor?.mode === "edit" ? customViews?.views.find((v) => v.id === editor.id) : undefined;
  // Every selectable category: what the view shows (not hidden, in a group that is not hidden).
  const all = detail ? viewCategories(detail, view).map((c) => c.id) : [];
  return (
    <div className="plan-page">
      <PlanHeader budgetId={budgetId} month={month} view={view} onViewAll={viewAll} />
      <ViewChips
        detail={detail}
        order={chipOrder(customViews)}
        selected={viewKey}
        onSelect={setViewKey}
        onNewView={() => setEditor({ mode: "new", from: "menu" })}
        onManageViews={() => setManageOpen(true)}
      />
      <div className="plan-body" ref={bodyRef} {...layout}>
        <PlanGrid
          budgetId={budgetId}
          month={month}
          selection={selection}
          onSelection={setSelection}
          editRequest={editRequest}
          view={view}
          onViewAll={viewAll}
          onEditView={
            custom ? () => setEditor({ mode: "edit", id: custom.id, from: "menu" }) : undefined
          }
        />
        <PlanPanel
          budgetId={budgetId}
          month={month}
          selected={visibleSelection(selection, all)}
          view={view}
          onViewAll={viewAll}
          onView={setViewKey}
          folded={"data-fold" in layout}
          onEditCategory={(id, anchor) => setEditRequest({ id, anchor, at: Date.now() })}
          bodyRef={bodyRef}
        />
      </div>
      <KeyboardTip />
      {manageOpen && (
        <ManageViewsDialog
          order={chipOrder(customViews)}
          paused={editor !== null}
          onReorder={(ids) => reorderViews.mutate(ids)}
          onEdit={(id) => setEditor({ mode: "edit", id, from: "manage" })}
          onDelete={async (id) => {
            await deleteView.mutateAsync(id);
            if (viewKey === id) setViewKey("all");
          }}
          onNew={() => setEditor({ mode: "new", from: "manage" })}
          onDone={() => setManageOpen(false)}
        />
      )}
      {editor && (editor.mode === "new" || editing) && (
        <CustomViewDialog
          key={editor.mode === "edit" ? editor.id : "new"}
          mode={editor.mode}
          groups={detail?.groups ?? []}
          storedIds={editing?.category_ids ?? []}
          initialName={editing?.name ?? ""}
          onCancel={() => setEditor(null)}
          onSave={async (name, categoryIds) => {
            if (editor.mode === "new") {
              const made = await createView.mutateAsync({ name, category_ids: categoryIds });
              setViewKey(made.id);
            } else {
              await updateView.mutateAsync({ id: editor.id, name, category_ids: categoryIds });
            }
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}

function PlanPage() {
  const { budgetId, month: parsed } = usePlanMonth();
  const { month: raw } = useParams();
  // No month in the URL: the source keeps /budget and shows the current month (polish P2).
  const month = raw === undefined ? localCurrentMonth() : parsed;
  useEnterDueOnOpen(budgetId);
  usePageTitle("Plan");
  useEffect(() => {
    if (month) rememberMonth(budgetId, month);
  }, [budgetId, month]);
  // A present but invalid month is replaced with the current month's canonical URL.
  if (!month) return <Navigate replace to={planPath(budgetId, localCurrentMonth())} />;
  return <PlanContent key={budgetId} budgetId={budgetId} month={month} />;
}

export const page = { path: "/:budgetId/budget/:month?", element: <PlanPage /> };
