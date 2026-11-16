import { useMemo } from "react";
import { useAccounts } from "../api/accounts";
import { FilterButton } from "./FilterButton";
import { FilterPopover } from "./FilterPopover";
import { accountSections, excludedAfterDone, leafIds } from "./filters";
import { useReportState } from "./state";

export function AccountFilter() {
  const { budgetId, report, settings, update } = useReportState();
  const { data } = useAccounts(budgetId);
  const nodes = useMemo(() => accountSections(data ?? [], report), [data, report]);
  const ids = leafIds(nodes);
  const excluded = new Set(settings.excluded_account_ids);
  const selected = new Set(ids.filter((id) => !excluded.has(id)));
  return (
    <FilterButton kind="accounts" total={ids.length} selected={selected.size}>
      {({ anchorRef, close }) => (
        <FilterPopover
          anchorRef={anchorRef}
          title="Select Accounts"
          searchPlaceholder="Search All Accounts"
          nodes={nodes}
          selected={selected}
          onClose={close}
          onDone={(s) => {
            update({
              excluded_account_ids: excludedAfterDone(ids, s, settings.excluded_account_ids),
            });
            close();
          }}
        />
      )}
    </FilterButton>
  );
}
