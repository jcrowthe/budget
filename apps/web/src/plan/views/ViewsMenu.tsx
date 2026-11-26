import { Popover } from "../Popover";
import "./views.css";

/** The chip row's filter menu: Manage Views and ⊕ New View. Closes on a choice, Escape or an outside press. */
export function ViewsMenu({
  anchor,
  onClose,
  onNewView,
  onManageViews,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onNewView: () => void;
  onManageViews: () => void;
}) {
  const pick = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <Popover
      anchor={anchor}
      width={180}
      label="Views menu"
      onClose={onClose}
      dismissOnOutside
      gap={8}
    >
      <div role="menu" className="views-menu">
        <button
          type="button"
          role="menuitem"
          className="views-menu-item"
          onClick={pick(onManageViews)}
        >
          Manage Views
        </button>
        <button type="button" role="menuitem" className="views-menu-item" onClick={pick(onNewView)}>
          ⊕ New View
        </button>
      </div>
    </Popover>
  );
}
