// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import { useState } from "react";
import {
  BarsOffIcon,
  BarsOnIcon,
  ClockBackIcon,
  PlusCircleFillIcon,
  RedoIcon,
  UndoIcon,
} from "./icons";
import { RecentMovesPopover } from "./recent-moves/RecentMovesPopover";

const UNDO_TITLE = "Undo the last thing you did (in Budget, not in life).";
const REDO_TITLE = "Redo that thing you just undid. Practice decisiveness.";

/** Recent Moves opens the plan's recent moves popover. Undo and Redo work the shared stack; their titles show only while enabled. */
export function Toolbar({
  bars,
  setBars,
  onAddGroup,
  addGroupDisabled = false,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSelectCategory,
}: {
  bars: boolean;
  setBars: (on: boolean) => void;
  onAddGroup: (anchor: HTMLElement) => void;
  /** Disabled while a view other than All is shown. */
  addGroupDisabled?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Selects a category row (a Recent Moves chip opens its month and selects it). */
  onSelectCategory?: (id: string) => void;
}) {
  const [recent, setRecent] = useState<HTMLElement | null>(null);
  return (
    <div className="grid-toolbar" role="row">
      <button
        type="button"
        className="toolbar-button is-view-disabled"
        disabled={addGroupDisabled}
        title="Add Category Group"
        onClick={(e) => onAddGroup(e.currentTarget)}
      >
        <PlusCircleFillIcon />
        Category Group
      </button>
      <button
        type="button"
        className="toolbar-button"
        disabled={!canUndo}
        title={canUndo ? UNDO_TITLE : undefined}
        aria-keyshortcuts="Control+Z Meta+Z"
        onClick={onUndo}
      >
        <UndoIcon />
        <span className="toolbar-label">Undo</span>
      </button>
      <button
        type="button"
        className="toolbar-button"
        disabled={!canRedo}
        title={canRedo ? REDO_TITLE : undefined}
        aria-keyshortcuts="Control+Y Meta+Y Control+Shift+Z Meta+Shift+Z"
        onClick={onRedo}
      >
        <RedoIcon />
        <span className="toolbar-label">Redo</span>
      </button>
      <button
        type="button"
        className="toolbar-button"
        title="Previous 34 days of assigning and moving money"
        onClick={(e) => setRecent(e.currentTarget)}
      >
        <ClockBackIcon />
        Recent Moves
      </button>
      {recent && (
        <RecentMovesPopover
          anchor={recent}
          onClose={() => setRecent(null)}
          onSelectCategory={onSelectCategory}
        />
      )}
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
