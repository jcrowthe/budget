// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import type { Month } from "@budget/core/month";
import { useEffect, useState } from "react";
import { useCommitAssigned } from "../api/assigned";
import { useCategoryActions } from "../api/categories";
import { ApiError } from "../api/client";
import { useMonth } from "../api/months";
import { useMoveMoney } from "../api/moves";
import type { CloseHow } from "./AssignedCell";
import { CoverPopover } from "./CoverPopover";
import { useCollapsedGroups } from "./collapse";
import { DeleteDialog } from "./DeleteDialog";
import { HiddenCategoriesRow } from "./HiddenCategories";
import { ChevronDownIcon, ChevronRightSmallIcon } from "./icons";
import { MovePopover } from "./MovePopover";
import { NamePopover } from "./NamePopover";
import { useProgressBars } from "./progressBars";
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
import { Toolbar } from "./Toolbar";
import "./plan-grid.css";

/** The one open popover or dialog: opening another replaces it. */
type Open =
  | { kind: "add-group"; anchor: HTMLElement }
  | { kind: "add-category"; groupId: string; anchor: HTMLElement }
  | { kind: "edit-group"; groupId: string; anchor: HTMLElement }
  | { kind: "edit-category"; categoryId: string; anchor: HTMLElement }
  | { kind: "move"; categoryId: string; anchor: HTMLElement }
  | { kind: "cover"; categoryId: string; anchor: HTMLElement }
  | {
      kind: "delete";
      what: "category" | "group";
      id: string;
      name: string;
      ids: string[];
      transactionCount: number;
    };

/** Asks the grid to open a category's edit popover (the inspector's pencil). */
export type EditRequest = { id: string; anchor: HTMLElement; at: number };

export function PlanGrid({
  budgetId,
  month,
  selection,
  onSelection,
  editRequest,
}: {
  budgetId: string;
  month: Month;
  selection: Selection;
  onSelection: (f: (s: Selection) => Selection) => void;
  editRequest: EditRequest | null;
}) {
  const q = useMonth(budgetId, month);
  const data = q.data;
  const [bars, setBars] = useProgressBars();
  const { isCollapsed, setCollapsed } = useCollapsedGroups(budgetId, data?.groups);
  const groups = (data?.groups ?? []).filter((g) => !g.hidden);
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
  const move = useMoveMoney(budgetId, () => setNotice("Couldn't move the money."));
  // Visible categories in render order: what ↑/↓ walks.
  const order = groups.flatMap((g) =>
    isCollapsed(g.id) ? [] : g.categories.filter((c) => !c.hidden).map((c) => c.id),
  );
  // Every selectable category, collapsed groups included (Uncategorized is never one).
  const all = groups.flatMap((g) => g.categories.filter((c) => !c.hidden).map((c) => c.id));
  const selected = new Set(visibleSelection(selection, all));
  usePlanShortcuts({
    onStep: (dir) => onSelection((s) => step(s, order, dir)),
    onExtend: (dir) => onSelection((s) => extend(s, order, dir)),
    onSelectAll: () => onSelection((s) => selectAll(all, s)),
    onClear: () => onSelection(() => ({ ids: [], anchor: null, cursor: null })),
    onCollapseAll: (collapsed) => setCollapsed(ids, collapsed),
  });
  const editAt = editRequest?.at;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new request (its timestamp) is the trigger
  useEffect(() => {
    if (editRequest)
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
    const dialog = (transactionCount: number): Open => ({
      kind: "delete",
      what,
      id,
      name,
      ids,
      transactionCount,
    });
    try {
      const usage = await (what === "group" ? actions.groupUsage(id) : actions.categoryUsage(id));
      if (usage.has_history) {
        setPop(dialog(usage.transaction_count));
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
          setPop(dialog(usage.transaction_count));
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
      if (!g) return null;
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
      if (!c) return null;
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
        groups={allGroups}
        onDone={close}
        onCancel={close}
      />
    );
  };

  const headerLabel = allCollapsed ? "Expand all" : "Collapse all";
  return (
    <section className={`plan-grid${bars ? " bars-on" : ""}`}>
      <div role="treegrid" aria-label="Plan" aria-busy={!data}>
        <div className="grid-head" role="rowgroup">
          <Toolbar
            bars={bars}
            setBars={setBars}
            onAddGroup={(anchor) => setPop({ kind: "add-group", anchor })}
          />
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
                label={all.length > 0 && selected.size === all.length ? "Uncheck all" : "Check all"}
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
            {notice && (
              <div className="grid-notice" role="alert">
                {notice}
              </div>
            )}
            {data?.uncategorized && <UncategorizedRow u={data.uncategorized} />}
            {groups.map((g) => {
              const collapsed = isCollapsed(g.id);
              return (
                <div key={g.id} className="group-block" role="presentation">
                  <GroupRow
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
                  {!collapsed &&
                    g.categories
                      .filter((c) => !c.hidden)
                      .map((c) => (
                        <CategoryRow
                          key={c.id}
                          c={c}
                          bars={bars}
                          selected={selected.has(c.id)}
                          onSelect={(how) =>
                            onSelection((s) =>
                              how === "only" ? selectOnly(c.id) : toggle(s, c.id),
                            )
                          }
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
                          onPill={(anchor) =>
                            setPop({
                              kind: c.available > 0 ? "move" : "cover",
                              categoryId: c.id,
                              anchor,
                            })
                          }
                        />
                      ))}
                </div>
              );
            })}
            {data && (
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
