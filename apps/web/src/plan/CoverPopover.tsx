import type { Month } from "@budget/core/month";
import type { MonthCategoryDetail, MonthDetail } from "@budget/schema/months";
import { useState } from "react";
import type { MoveRequest } from "../api/moves";
import { CategoryPicker } from "./CategoryPicker";
import { Popover } from "./Popover";

const positive = (c: MonthCategoryDetail) => c.available > 0;

/** "Cover overspending from [Ready to Assign or a category with money]": moves exactly the overspent amount. */
export function CoverPopover({
  detail,
  month,
  categoryId,
  anchor,
  onClose,
  move,
}: {
  detail: MonthDetail;
  month: Month;
  categoryId: string;
  anchor: HTMLElement;
  onClose: () => void;
  move: (m: MoveRequest) => Promise<void>;
}) {
  const c = detail.groups.flatMap((g) => g.categories).find((x) => x.id === categoryId);
  const [from, setFrom] = useState<string | null>(null);
  const submit = () => {
    if (from === null || !c) return;
    void move({ month, from, to: categoryId, amount: -c.available, cover: { categoryId } });
    onClose();
  };
  return (
    <Popover
      anchor={anchor}
      width={320}
      label="Cover overspending"
      className="move-popover"
      onClose={onClose}
    >
      <div className="move-label">Cover overspending from</div>
      <CategoryPicker
        groups={detail.groups}
        value={from}
        onChange={setFrom}
        include={positive}
        readyToAssign={detail.ready_to_assign}
        label="From"
        autoFocus
      />
      <div className="popover-buttons">
        <span className="popover-spacer" />
        <button type="button" className="popover-button is-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="popover-button is-primary"
          disabled={from === null}
          onClick={submit}
        >
          OK
        </button>
      </div>
    </Popover>
  );
}
