// Pure placement of the plan menu and its submenu (fixed positioning, viewport coordinates).
export type Rect = { left: number; top: number; right: number; bottom: number };
export const MENU_GAP = 8;
export const MENU_EDGE = 16;
export const VIEW_MARGIN = 8;

export function placeMenu(button: Rect, vh: number) {
  const top = button.bottom + MENU_GAP;
  return { left: button.left, top, maxHeight: Math.max(0, vh - top - MENU_EDGE) };
}

/** Beside the collapsed rail, level with its top button. */
export function placeMenuBeside(button: Rect, railRight: number, vh: number) {
  return {
    left: railRight + MENU_GAP,
    top: button.top,
    maxHeight: Math.max(0, vh - button.top - MENU_EDGE),
  };
}

/** At the right edge of the Open Plan row; flips to its left, then shifts, when there is no room. Always inside the window. */
export function placeSubmenu(
  menu: Rect,
  row: Rect,
  size: { width: number; height: number },
  vw: number,
  vh: number,
) {
  // Source: the submenu starts at the Open Plan row's right edge (overlapping the menu's padding), level with its top.
  let left = row.right;
  if (left + size.width > vw - VIEW_MARGIN) {
    left = menu.left - size.width;
    if (left < VIEW_MARGIN) left = Math.max(VIEW_MARGIN, vw - VIEW_MARGIN - size.width);
  }
  let top = row.top;
  top = Math.min(top, vh - VIEW_MARGIN - size.height);
  top = Math.max(VIEW_MARGIN, top);
  return { left, top, maxHeight: vh - 2 * VIEW_MARGIN };
}
