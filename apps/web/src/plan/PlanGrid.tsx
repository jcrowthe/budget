// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import type { Month } from "@budget/core/month";
import {
  type PlanView,
  VIEW_EMPTY_TEXT,
  VIEW_HIDDEN_FOOTER,
  viewDetail,
} from "@budget/schema/plan-views";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { carryPlanWhere, planWhere, useCommitAssigned } from "../api/assigned";
import { useCategoryActions } from "../api/categories";
import { ApiError } from "../api/client";
import { beginWrite, endWrite, inOrder } from "../api/monthCache";
import { useMonth } from "../api/months";
import { useMoveMoney } from "../api/moves";
import { useMovedCategories } from "../api/recent-moves";
import { localCurrentMonth, usePlanMonth } from "../shell/planPaths";
import { useShortcut } from "../shortcuts/dispatcher";
import { getSnapshot, redo as redoStep, undo as undoStep } from "../undo/store";
import { useUndo } from "../undo/useUndo";
import type { CloseHow } from "./AssignedCell";
import { ActivityPopover } from "./activity-popover";
import { CoverPopover } from "./CoverPopover";
import { useCollapsedGroups } from "./collapse";
import { useNumberColumns } from "./columnWidths";
import { DeleteDialog } from "./DeleteDialog";
import { usePlanDnd } from "./dnd";
import { HiddenCategoriesRow } from "./HiddenCategories";
import { ChevronDownIcon, ChevronRightSmallIcon } from "./icons";
import { MovePopover } from "./MovePopover";
import { NamePopover } from "./NamePopover";
import { useProgressBars } from "./progressBars";
import { CategoryMovesPopover } from "./recent-moves/RecentMovesPopover";
import { CategoryRow, Checkbox, type FocusTarget, GroupRow, UncategorizedRow } from "./rows";
import {
  checkState,
  extend,
  headerClick,
  type Selection,
  selectAll,
  selectOnly,
  step,
  toggle,
  toggleMany,
  visibleSelection,
} from "./selection";
import { usePlanShortcuts } from "./shortcuts";
import { useToggleSnooze } from "./snooze";
import { Toolbar } from "./Toolbar";
import "./plan-grid.css";

/** The one open popover or dialog: opening another replaces it. */
type Open =
  | { kind: "add-group"; anchor: HTMLElement }
  | { kind: "add-category"; groupId: string; anchor: HTMLElement }
  | { kind: "edit-group"; groupId: string; anchor: HTMLElement }
  | { kind: "edit-category"; categoryId: string; anchor: HTMLElement }
  | { kind: "activity"; categoryId: string; anchor: HTMLElement }
  | { kind: "moves"; categoryId: string; anchor: HTMLElement }
  | { kind: "move"; categoryId: string; anchor: HTMLElement }
  | { kind: "cover"; categoryId: string; anchor: HTMLElement }
  | {
      kind: "delete";
      what: "category" | "group";
      id: string;
      name: string;
      ids: string[];
      transactionCount: number;
      scheduledCount: number;
    };

/** Asks the grid to open a category's edit popover (the inspector's pencil). */
export type EditRequest = { id: string; anchor: HTMLElement; at: number };

export function PlanGrid({
  budgetId,
  month,
  selection,
  onSelection,
  editRequest,
  view,
  onViewAll,
}: {
  budgetId: string;
  month: Month;
  selection: Selection;
  onSelection: (f: (s: Selection) => Selection) => void;
  editRequest: EditRequest | null;
  /** The Plan view in use; anything but "all" narrows the rows (see plan-views.ts). */
  view: PlanView;
  onViewAll: () => void;
}) {
  const q = useMonth(budgetId, month);
  const moved = useMovedCategories(budgetId, month, q.dataUpdatedAt);
  const data = q.data;
  const [bars, setBars] = useProgressBars();
  const { isCollapsed, setCollapsed } = useCollapsedGroups(budgetId, data?.groups);
  const columns = useNumberColumns(data);
  const shown = data && viewDetail(data, view);
  const groups = (shown?.groups ?? []).filter((g) => !g.hidden);
  const inView = view !== "all";
  const ids = groups.map((g) => g.id);
  const allCollapsed = groups.length > 0 && groups.every((g) => isCollapsed(g.id));

  const [editing, setEditing] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; target: FocusTarget; at: number } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [pop, setPop] = useState<Open | null>(null);
  const actions = useCategoryActions(budgetId);
  const commit = useCommitAssigned(budgetId, month, () =>
    setNotice("Couldn't save the assigned amount."),
  );
  const dnd = usePlanDnd({
    groups: data?.groups ?? [],
    onMoveCategory: (id, body) =>
      void actions.moveCategory(id, body).catch(() => setNotice("Couldn't move the category.")),
    onMoveGroup: (id, body) =>
      void actions.moveGroup(id, body).catch(() => setNotice("Couldn't move the group.")),
  });
  const move = useMoveMoney(budgetId, () => setNotice("Couldn't move the money."));
  const qc = useQueryClient();
  const { setMonth } = usePlanMonth();
  const { canUndo, canRedo } = useUndo(budgetId);
  // Undo or redo the top entry of the shared stack (docs/plan-undo-design.md): go to the month it changed first
  // (D6), run it in the plan's write queue so it never overtakes a pending Assigned PATCH, then refetch.
  const runStep = async (from: "undo" | "redo") => {
    if (!(from === "undo" ? canUndo : canRedo)) return;
    const top = getSnapshot(budgetId)[from].at(-1);
    if (!top) return;
    const where = planWhere(top.changeSetId);
    if (where?.month && where.month !== month) setMonth(where.month);
    await beginWrite(qc, budgetId);
    try {
      const result = await inOrder(budgetId, () =>
        (from === "undo" ? undoStep : redoStep)(budgetId),
      );
      const own = getSnapshot(budgetId)[from === "undo" ? "redo" : "undo"].at(-1);
      if (where && own) carryPlanWhere(top.changeSetId, own.changeSetId);
      // An entry the Plan did not record (a register one): the server's where, when it is a plan month.
      if (!where && result?.surface === "plan" && result.month && result.month !== month)
        setMonth(result.month as Month);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 403 || e.status === 404))
        setNotice(e.detail);
      else setNotice(from === "undo" ? "Couldn't undo." : "Couldn't redo.");
    } finally {
      // Everything of the plan but the months (categories, usage, targets, accounts...); the months refetch
      // once no write is pending (the cached-month rule).
      void qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey.includes(budgetId) &&
          !["month", "month-list", "auto-assign"].includes(q.queryKey[0] as string),
      });
      endWrite(qc, budgetId);
    }
  };
  useShortcut("undo", () => void runStep("undo"));
  useShortcut("redo", () => void runStep("redo"));
  // Visible categories in render order: what ↑/↓ walks.
  const order = groups.flatMap((g) =>
    isCollapsed(g.id) ? [] : g.categories.filter((c) => !c.hidden).map((c) => c.id),
  );
  // Every selectable category, collapsed groups included (Uncategorized is never one).
  const all = groups.flatMap((g) => g.categories.filter((c) => !c.hidden).map((c) => c.id));
  const selected = new Set(visibleSelection(selection, all));
  const snooze = useToggleSnooze(budgetId, month);
  usePlanShortcuts({
    onSnooze: () => {
      if (selected.size !== 1 || month !== localCurrentMonth()) return;
      const c = groups.flatMap((g) => g.categories).find((x) => selected.has(x.id));
      if (c?.target) snooze.toggle(c.id, !c.target_snoozed);
    },
    onStep: (dir) => onSelection((s) => step(s, order, dir)),
    onExtend: (dir) => onSelection((s) => extend(s, order, dir)),
    onSelectAll: () => onSelection((s) => selectAll(all, s)),
    onClear: () => onSelection(() => ({ ids: [], anchor: null, cursor: null })),
    onCollapseAll: (collapsed) => setCollapsed(ids, collapsed),
  });
  const editAt = editRequest?.at;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new request (its timestamp) is the trigger
  useEffect(() => {
    // A credit card payment category belongs to its account: it has no edit popover (EXF-532).
    const target = data?.groups.flatMap((g) => g.categories).find((c) => c.id === editRequest?.id);
    if (editRequest && target?.kind !== "credit_card_payment")
      setPop({ kind: "edit-category", categoryId: editRequest.id, anchor: editRequest.anchor });
  }, [editAt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: month is the trigger
  useEffect(() => {
    setEditing(null);
    setPop((p) => (p?.kind === "move" || p?.kind === "cover" ? null : p));
  }, [month]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const closeCell = (id: string, how: CloseHow, committed?: Promise<void>) => {
    const i = order.indexOf(id);
    if (how === "next" || how === "prev") {
      const to = order[how === "next" ? i + 1 : i - 1];
      setEditing(to ?? null);
      if (to) onSelection(() => selectOnly(to));
      return;
    }
    setEditing(null);
    if (how === "tab") {
      (committed ?? Promise.resolve()).then(() =>
        setFocusReq({ id, target: "available", at: Date.now() }),
      );
    } else if (how === "shiftTab") {
      setFocusReq({ id, target: "name", at: Date.now() });
    }
  };

  const close = () => setPop(null);
  const allGroups = data?.groups ?? [];

  /** Deletes at once when there is no history, else opens the dialog (also when a racing write adds some). */
  const startDelete = async (
    what: "category" | "group",
    id: string,
    name: string,
    ids: string[],
  ) => {
    const dialog = (transactionCount: number, scheduledCount: number): Open => ({
      kind: "delete",
      what,
      id,
      name,
      ids,
      transactionCount,
      scheduledCount,
    });
    try {
      const usage = await (what === "group" ? actions.groupUsage(id) : actions.categoryUsage(id));
      if (usage.has_history || usage.scheduled_count > 0) {
        setPop(dialog(usage.transaction_count, usage.scheduled_count));
        return;
      }
      await (what === "group" ? actions.deleteGroup(id) : actions.deleteCategory(id));
      close();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          const usage = await (what === "group"
            ? actions.groupUsage(id)
            : actions.categoryUsage(id));
          setPop(dialog(usage.transaction_count, usage.scheduled_count));
        } catch {
          close();
          setNotice(`Couldn't delete the ${what}.`);
        }
        return;
      }
      close();
      setNotice(`Couldn't delete the ${what}.`);
    }
  };

  const renderPopover = () => {
    if (!pop) return null;
    if (pop.kind === "add-group") {
      return (
        <NamePopover
          anchor={pop.anchor}
          mode="add-group"
          onSubmit={async (name) => void (await actions.createGroup(name))}
          onClose={close}
        />
      );
    }
    if (pop.kind === "add-category") {
      return (
        <NamePopover
          anchor={pop.anchor}
          mode="add-category"
          onSubmit={async (name) => void (await actions.createCategory(pop.groupId, name))}
          onClose={close}
        />
      );
    }
    if (pop.kind === "edit-group") {
      const g = allGroups.find((x) => x.id === pop.groupId);
      if (!g || g.kind !== null) return null;
      return (
        <NamePopover
          anchor={pop.anchor}
          mode="edit-group"
          initial={g.name}
          onSubmit={async (name) => void (await actions.updateGroup(g.id, { name }))}
          onHide={async () => void (await actions.updateGroup(g.id, { hidden: true }))}
          onDelete={() =>
            void startDelete(
              "group",
              g.id,
              g.name,
              g.categories.map((c) => c.id),
            )
          }
          onClose={close}
        />
      );
    }
    if (pop.kind === "edit-category") {
      const c = allGroups.flatMap((x) => x.categories).find((x) => x.id === pop.categoryId);
      if (!c || c.kind !== null) return null;
      return (
        <NamePopover
          anchor={pop.anchor}
          mode="edit-category"
          initial={c.name}
          onSubmit={async (name) => void (await actions.updateCategory(c.id, { name }))}
          onHide={async () => void (await actions.updateCategory(c.id, { hidden: true }))}
          onDelete={() => void startDelete("category", c.id, c.name, [c.id])}
          onClose={close}
        />
      );
    }
    if (pop.kind === "activity") {
      const c = allGroups.flatMap((x) => x.categories).find((x) => x.id === pop.categoryId);
      if (!c || c.kind !== null) return null;
      return (
        <ActivityPopover
          budgetId={budgetId}
          month={month}
          category={c}
          anchor={pop.anchor}
          onClose={close}
        />
      );
    }
    if (pop.kind === "moves") {
      const c = allGroups.flatMap((x) => x.categories).find((x) => x.id === pop.categoryId);
      if (!c) return null;
      return (
        <CategoryMovesPopover
          anchor={pop.anchor}
          month={month}
          category={{ id: c.id, name: c.name }}
          onClose={close}
        />
      );
    }
    if (pop.kind === "move" || pop.kind === "cover") {
      if (!data) return null;
      const Pop = pop.kind === "move" ? MovePopover : CoverPopover;
      return (
        <Pop
          detail={data}
          month={month}
          categoryId={pop.categoryId}
          anchor={pop.anchor}
          onClose={close}
          move={move}
        />
      );
    }
    return (
      <DeleteDialog
        budgetId={budgetId}
        kind={pop.what}
        id={pop.id}
        name={pop.name}
        ids={pop.ids}
        categoryCount={pop.ids.length}
        transactionCount={pop.transactionCount}
        scheduledCount={pop.scheduledCount}
        groups={allGroups}
        onDone={close}
        onCancel={close}
      />
    );
  };

  const headerLabel = allCollapsed ? "Expand all" : "Collapse all";
  return (
    <section className={`plan-grid${bars ? " bars-on" : ""}`} style={columns}>
      <div role="treegrid" aria-label="Plan" aria-busy={!data}>
        <div className="grid-head" role="rowgroup">
          <Toolbar
            bars={bars}
            setBars={setBars}
            onAddGroup={(anchor) => setPop({ kind: "add-group", anchor })}
            addGroupDisabled={inView}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => void runStep("undo")}
            onRedo={() => void runStep("redo")}
            onSelectCategory={(id) => onSelection(() => selectOnly(id))}
          />
          {!(inView && groups.length === 0 && data) && (
            <div className="grid-row header-row" role="row">
              <div className="cell-margin" />
              <div className="cell-collapse">
                <button
                  type="button"
                  className="collapse-button"
                  aria-label={headerLabel}
                  title={headerLabel}
                  onClick={() => setCollapsed(ids, !allCollapsed)}
                >
                  {allCollapsed ? <ChevronRightSmallIcon /> : <ChevronDownIcon />}
                </button>
              </div>
              <div className="cell-checkbox">
                <Checkbox
                  label={
                    all.length > 0 && selected.size === all.length ? "Uncheck all" : "Check all"
                  }
                  checked={checkState(all, selected)}
                  onChange={() => onSelection((s) => headerClick(s, all))}
                />
              </div>
              <div className="cell-name" role="columnheader">
                <strong>CATEGORY</strong>
              </div>
              <div
                className="num cell-assigned"
                role="columnheader"
                title="Add money to each category in this column. This is the fun part. Until the money runs out."
              >
                <strong>ASSIGNED</strong>
              </div>
              <div
                className="num cell-activity"
                role="columnheader"
                title={`It's the "We spent how much on WHAT?!" column.`}
              >
                <strong>ACTIVITY</strong>
              </div>
              <div
                className="num cell-available"
                role="columnheader"
                title="Do I have enough to buy that handmade didgeridoo? With this column, now you know."
              >
                <strong>AVAILABLE</strong>
              </div>
              <div className="cell-margin" />
            </div>
          )}
        </div>
        {q.isError && !data ? (
          <div className="grid-error" role="alert">
            <span>Couldn't load this month.</span>
            <button type="button" className="toolbar-button" onClick={() => q.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <div className="grid-body" role="rowgroup">
            <div className="reorder-live" aria-live="polite" role="status">
              {dnd.announcement}
            </div>
            {notice && (
              <div className="grid-notice" role="alert">
                {notice}
              </div>
            )}
            {!inView && data?.uncategorized && <UncategorizedRow u={data.uncategorized} />}
            {groups.map((g) => {
              const collapsed = isCollapsed(g.id);
              const t = dnd.target;
              const gap = (kind: "category" | "group") => (
                <div
                  className={`grid-row drop-gap drop-gap-${kind}`}
                  role="presentation"
                  data-testid="drop-gap"
                  {...dnd.gap}
                />
              );
              const groupGap = t?.kind === "group" ? t.gap : null;
              const catGap = t?.kind === "category" ? t.gap : null;
              const visible = g.categories.filter((c) => !c.hidden);
              return (
                <Fragment key={g.id}>
                  {groupGap?.before === g.id && gap("group")}
                  <div
                    className={`group-block${dnd.draggingId === g.id ? " is-drag-source" : ""}`}
                    role="presentation"
                    {...dnd.groupBlock(g)}
                  >
                    <GroupRow
                      drag={dnd.groupRow(g)}
                      g={g}
                      collapsed={collapsed}
                      onToggle={() => setCollapsed([g.id], !collapsed)}
                      onEditName={(anchor) => setPop({ kind: "edit-group", groupId: g.id, anchor })}
                      onAddCategory={(anchor) =>
                        setPop({ kind: "add-category", groupId: g.id, anchor })
                      }
                      addOpen={pop?.kind === "add-category" && pop.groupId === g.id}
                      checked={checkState(
                        g.categories.filter((c) => !c.hidden).map((c) => c.id),
                        selected,
                      )}
                      onCheck={() =>
                        onSelection((s) =>
                          toggleMany(
                            s,
                            g.categories.filter((c) => !c.hidden).map((c) => c.id),
                          ),
                        )
                      }
                    />
                    {catGap?.top === g.id && gap("category")}
                    {!collapsed &&
                      visible.map((c) => (
                        <Fragment key={c.id}>
                          {catGap?.before === c.id && gap("category")}
                          <CategoryRow
                            drag={dnd.categoryRow(c, g)}
                            dragging={dnd.draggingId === c.id}
                            c={c}
                            bars={bars}
                            selected={selected.has(c.id)}
                            onSelect={(how) =>
                              onSelection((s) =>
                                how === "only" ? selectOnly(c.id) : toggle(s, c.id),
                              )
                            }
                            onNameClick={(anchor) => {
                              // EXF-592: a click on the name of the one selected category opens its edit popover.
                              if (c.kind === null && selected.size === 1 && selected.has(c.id)) {
                                setPop({ kind: "edit-category", categoryId: c.id, anchor });
                              } else onSelection(() => selectOnly(c.id));
                            }}
                            editing={editing === c.id}
                            onOpen={() => {
                              onSelection(() => selectOnly(c.id));
                              setEditing(c.id);
                              setFocusReq(null);
                              setNotice(null);
                            }}
                            onClose={(how, p) => closeCell(c.id, how, p)}
                            onCommit={(after) => commit(c.id, c.assigned, after)}
                            focusRequest={
                              focusReq && focusReq.id === c.id && Date.now() - focusReq.at < 1000
                                ? focusReq.target
                                : null
                            }
                            onFocusDone={() => setFocusReq(null)}
                            onContextMenu={(anchor) =>
                              setPop({ kind: "edit-category", categoryId: c.id, anchor })
                            }
                            onActivity={(anchor) =>
                              setPop({ kind: "activity", categoryId: c.id, anchor })
                            }
                            hasMoves={moved.data?.has(c.id) ?? false}
                            onMoves={(anchor) =>
                              setPop({ kind: "moves", categoryId: c.id, anchor })
                            }
                            onPill={(anchor) =>
                              setPop({
                                kind: c.available > 0 ? "move" : "cover",
                                categoryId: c.id,
                                anchor,
                              })
                            }
                          />
                          {catGap?.after === c.id && gap("category")}
                        </Fragment>
                      ))}
                  </div>
                  {groupGap?.after === g.id && gap("group")}
                </Fragment>
              );
            })}
            {inView && data && groups.length === 0 && (
              <div className="view-empty">
                <p>{VIEW_EMPTY_TEXT[view]}</p>
                <button type="button" className="view-all" onClick={onViewAll}>
                  View All
                </button>
              </div>
            )}
            {inView && groups.length > 0 && (
              <div className="view-footer">
                <span>{VIEW_HIDDEN_FOOTER}</span>
                <button type="button" className="view-all" onClick={onViewAll}>
                  View All
                </button>
              </div>
            )}
            {!inView && data && (
              <HiddenCategoriesRow
                groups={data.groups}
                budgetId={budgetId}
                onError={() => setNotice("Couldn't unhide.")}
              />
            )}
          </div>
        )}
      </div>
      {renderPopover()}
    </section>
  );
}
