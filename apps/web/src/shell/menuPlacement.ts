// Pure placement of the plan menu and its submenu (fixed positioning, viewport coordinates).
export type Rect = { left: number; top: number; right: number; bottom: number };
export const MENU_GAP = 8;
export const MENU_EDGE = 16;
export const VIEW_MARGIN = 8;
export const SUB_OFFSET = 4;

export function placeMenu(button: Rect, vh: number) {
  const top = button.bottom + MENU_GAP;
  return { left: button.left, top, maxHeight: Math.max(0, vh - top - MENU_EDGE) };
}

/** To the right of the menu; flips to its left, then shifts, when there is no room. Always inside the window. */
export function placeSubmenu(
  menu: Rect,
  row: Rect,
  size: { width: number; height: number },
  vw: number,
  vh: number,
) {
  let left = menu.right;
  if (left + size.width > vw - VIEW_MARGIN) {
    left = menu.left - size.width;
    if (left < VIEW_MARGIN) left = Math.max(VIEW_MARGIN, vw - VIEW_MARGIN - size.width);
  }
  let top = row.top - SUB_OFFSET;
  top = Math.min(top, vh - VIEW_MARGIN - size.height);
  top = Math.max(VIEW_MARGIN, top);
  return { left, top, maxHeight: vh - 2 * VIEW_MARGIN };
}
