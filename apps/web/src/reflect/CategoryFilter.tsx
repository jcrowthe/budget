import { monthOfDate } from "@budget/schema/report-range";
import { useMemo } from "react";
import { useMonth } from "../api/months";
import { FilterButton } from "./FilterButton";
import { FilterPopover } from "./FilterPopover";
import { categoryItems, excludedAfterDone, leafIds } from "./filters";
import { useReportState } from "./state";

export function CategoryFilter() {
  const { budgetId, settings, today, update } = useReportState();
  const { data } = useMonth(budgetId, monthOfDate(today));
  const nodes = useMemo(() => categoryItems(data), [data]);
  const ids = leafIds(nodes);
  const excluded = new Set(settings.excluded_category_ids);
  const selected = new Set(ids.filter((id) => !excluded.has(id)));
  return (
    <FilterButton kind="categories" total={ids.length} selected={selected.size}>
      {({ anchorRef, close }) => (
        <FilterPopover
          // A late read changes the listed items: start the draft again from them.
          key={ids.length}
          anchorRef={anchorRef}
          title="Select Categories"
          searchPlaceholder="Search All Categories"
          nodes={nodes}
          selected={selected}
          onClose={close}
          onDone={(s) => {
            update({
              excluded_category_ids: excludedAfterDone(ids, s, settings.excluded_category_ids),
            });
            close();
          }}
        />
      )}
    </FilterButton>
  );
}
