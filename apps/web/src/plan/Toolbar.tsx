// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import {
  BarsOffIcon,
  BarsOnIcon,
  ClockBackIcon,
  PlusCircleFillIcon,
  RedoIcon,
  UndoIcon,
} from "./icons";

/** Undo, Redo and Recent Moves do nothing yet (the undo ticket gives them actions). */
export function Toolbar({
  bars,
  setBars,
  onAddGroup,
}: {
  bars: boolean;
  setBars: (on: boolean) => void;
  onAddGroup: (anchor: HTMLElement) => void;
}) {
  return (
    <div className="grid-toolbar" role="row">
      <button
        type="button"
        className="toolbar-button"
        title="Add Category Group"
        onClick={(e) => onAddGroup(e.currentTarget)}
      >
        <PlusCircleFillIcon />
        Category Group
      </button>
      <button type="button" className="toolbar-button" disabled>
        <UndoIcon />
        Undo
      </button>
      <button type="button" className="toolbar-button" disabled>
        <RedoIcon />
        Redo
      </button>
      <button
        type="button"
        className="toolbar-button"
        title="Previous 34 days of assigning and moving money"
      >
        <ClockBackIcon />
        Recent Moves
      </button>
      <div className="segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={bars}
          aria-label="Progress Bars On"
          title="Progress Bars On"
          onClick={() => setBars(true)}
        >
          <BarsOnIcon />
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!bars}
          aria-label="Progress Bars Off"
          title="Progress Bars Off"
          onClick={() => setBars(false)}
        >
          <BarsOffIcon />
        </button>
      </div>
    </div>
  );
}
