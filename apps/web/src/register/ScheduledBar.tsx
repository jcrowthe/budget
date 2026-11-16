import { countLabel } from "@budget/schema/register-selection";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tip } from "./BarTip";
import { CategorizeIcon, CloseSmallIcon, FlagFilledIcon, MoreDotsIcon } from "./icons";
import { MoreMenu } from "./MoreMenu";

const noop = () => {};

/**
 * The floating bar of a selection of scheduled rows: Enter Now and Delete work; Categorize, Flag and the other
 * More entries are drawn disabled in this Build. It is drawn like the real rows' bar.
 */
export function ScheduledBar({
  box,
  count,
  error,
  busy,
  onDeselect,
  onEnter,
  onDelete,
}: {
  box: { left: number; width: number };
  count: number;
  error: string | null;
  busy: boolean;
  onDeselect: () => void;
  onEnter: () => void;
  onDelete: () => void;
}) {
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const later = "Not available for scheduled transactions yet";
  return (
    <>
      {createPortal(
        <div className="register-action-bar-container" style={{ left: box.left, width: box.width }}>
          {error ? (
            <div className="register-action-bar-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="register-action-bar-inner" role="toolbar" aria-label="Selection actions">
            <button
              type="button"
              className="action-bar-button action-bar-uncheck"
              title="Deselect all"
              onClick={onDeselect}
            >
              <CloseSmallIcon />
              {countLabel(count)}
            </button>
            <hr />
            <Tip text="Enter Now" keys={["E"]}>
              {(tip) => (
                <button
                  {...tip}
                  type="button"
                  className="action-bar-button"
                  disabled={busy}
                  onClick={onEnter}
                >
                  Enter Now
                </button>
              )}
            </Tip>
            <button type="button" className="action-bar-button" disabled title={later}>
              <CategorizeIcon />
              Categorize
            </button>
            <button type="button" className="action-bar-button" disabled title={later}>
              <FlagFilledIcon />
              Flag
            </button>
            <hr />
            <button
              ref={moreBtn}
              type="button"
              className="action-bar-button"
              aria-haspopup="menu"
              onClick={() => setMore((m) => !m)}
            >
              <MoreDotsIcon />
              More
            </button>
          </div>
        </div>,
        document.body,
      )}
      {more && moreBtn.current ? (
        <MoreMenu
          scheduled
          anchor={moreBtn.current}
          count={count}
          unclear={false}
          oneRow={false}
          moveTo={null}
          onClose={() => setMore(false)}
          onUnclear={noop}
          onDuplicate={noop}
          onMemo={noop}
          onMove={noop}
          onExport={noop}
          onDelete={() => {
            setMore(false);
            onDelete();
          }}
        />
      ) : null}
    </>
  );
}
