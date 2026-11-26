import type { MonthCategoryDetail, MonthGroupDetail } from "@budget/schema/months";
import { READY_TO_ASSIGN } from "@budget/schema/moves";
import type { CategoryChoice } from "@budget/schema/register";
import { useMemo } from "react";
import { CategoryList } from "../shared/picker/CategoryList";

export { READY_TO_ASSIGN };

const RTA_NAME = "Inflow: Ready to Assign";

/**
 * The Plan's category chooser: the shared category list (shared/picker, EXF-589) with the Plan callers' filters. It
 * knows nothing about what the pick is for (EXF-491 Ready to Assign, EXF-492 move money, EXF-517 the register,
 * EXF-494 delete): the caller passes which categories to leave out.
 *
 * - `groups`: the month read model's groups.
 * - `value`: the picked category id (or READY_TO_ASSIGN), or null. `onChange(id)` runs when one is picked.
 * - `exclude`: category ids to leave out; groups left empty are dropped.
 * - `include`: keeps only the categories it accepts (positive Available for Cover and Fix This).
 * - `readyToAssign`: when set (the month's Ready to Assign), the list has Inflow with "Ready to Assign";
 *   picking it calls `onChange(READY_TO_ASSIGN)`.
 * - `includeHidden` (default true): hidden categories and groups of hidden groups stay pickable.
 * - `placeholder` (default "Select category"), `label` (the field's accessible name), `autoFocus`.
 */
export function CategoryPicker({
  groups,
  value,
  onChange,
  exclude,
  include,
  readyToAssign,
  placeholder = "Select category",
  label,
  includeHidden = true,
  autoFocus,
}: {
  groups: MonthGroupDetail[];
  value: string | null;
  onChange: (id: string | null) => void;
  exclude?: ReadonlySet<string>;
  include?: (c: MonthCategoryDetail) => boolean;
  readyToAssign?: number;
  placeholder?: string;
  label: string;
  includeHidden?: boolean;
  autoFocus?: boolean;
}) {
  const all = useMemo(
    () =>
      groups
        .filter((g) => includeHidden || !g.hidden)
        .map((g) => ({
          ...g,
          categories: g.categories.filter(
            (c) => !exclude?.has(c.id) && (includeHidden || !c.hidden) && (include?.(c) ?? true),
          ),
        }))
        .filter((g) => g.categories.length > 0),
    [groups, exclude, include, includeHidden],
  );
  const choice: CategoryChoice =
    value === null
      ? { kind: "none" }
      : value === READY_TO_ASSIGN
        ? { kind: "rta" }
        : { kind: "category", id: value };
  const text =
    value === READY_TO_ASSIGN
      ? RTA_NAME
      : (all.flatMap((g) => g.categories).find((c) => c.id === value)?.name ?? "");

  return (
    <CategoryList
      className="category-picker"
      caret={false}
      escapeClosesList
      autoFocus={autoFocus}
      label={label}
      placeholder={placeholder}
      groups={all}
      readyToAssign={readyToAssign}
      value={choice}
      text={text}
      onPick={(v) => onChange(v.kind === "rta" ? READY_TO_ASSIGN : v.id)}
    />
  );
}
