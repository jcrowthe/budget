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

/** The four action buttons do nothing yet: EXF-494 (Category Group) and the undo ticket give them actions. */
export function Toolbar({ bars, setBars }: { bars: boolean; setBars: (on: boolean) => void }) {
  return (
    <div className="grid-toolbar" role="row">
      <button type="button" className="toolbar-button" title="Add Category Group">
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
