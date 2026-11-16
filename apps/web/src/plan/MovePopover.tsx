import type { Month } from "@budget/core/month";
import type { MonthDetail } from "@budget/schema/months";
import { useMemo, useState } from "react";
import type { MoveRequest } from "../api/moves";
import { CategoryPicker } from "./CategoryPicker";
import { MoveAmountField } from "./MoveAmountField";
import { Popover } from "./Popover";

/** "Move [amount] To [category]": from a category with money available (more than Available is allowed). */
export function MovePopover({
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
  const base = c?.available ?? 0;
  const [amount, setAmount] = useState(base);
  const [to, setTo] = useState<string | null>(null);
  const exclude = useMemo(() => new Set([categoryId]), [categoryId]);
  const ok = to !== null && amount > 0;
  const submit = () => {
    if (!ok || to === null) return;
    void move({ month, from: categoryId, to, amount });
    onClose();
  };
  return (
    <Popover
      anchor={anchor}
      width={320}
      label="Move money"
      className="move-popover"
      onClose={onClose}
    >
      <div className="move-label">Move</div>
      <MoveAmountField base={base} onAmount={setAmount} onEnter={submit} />
      <div className="move-label">To</div>
      <CategoryPicker
        groups={detail.groups}
        value={to}
        onChange={setTo}
        exclude={exclude}
        readyToAssign={detail.ready_to_assign}
        label="To"
      />
      <div className="popover-buttons">
        <span className="popover-spacer" />
        <button type="button" className="popover-button is-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="popover-button is-primary" disabled={!ok} onClick={submit}>
          OK
        </button>
      </div>
    </Popover>
  );
}
