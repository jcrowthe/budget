/** The order after dropping `dragged` on `target` (top half: before it, bottom half: after it); null when nothing changes. */
export function dropOrder(
  order: readonly string[],
  dragged: string,
  target: string,
  top: boolean,
): string[] | null {
  if (dragged === target || !order.includes(dragged) || !order.includes(target)) return null;
  const rest = order.filter((id) => id !== dragged);
  const at = rest.indexOf(target) + (top ? 0 : 1);
  const next = [...rest.slice(0, at), dragged, ...rest.slice(at)];
  return next.join() === order.join() ? null : next;
}

/**
 * Keyboard reorder (our addition, as docs/reorder-design.md): Alt+Shift+ArrowUp/ArrowDown moves a card one place.
 * Null at either end. `nameOf` is for the announcement.
 */
export function keyboardOrder(
  order: readonly string[],
  id: string,
  dir: -1 | 1,
  nameOf: (id: string) => string,
): { ids: string[]; text: string } | null {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return null;
  const ids = [...order];
  ids[i] = order[j] as string;
  ids[j] = id;
  return { ids, text: `Moved ${nameOf(id)} to position ${j + 1} of ${order.length}.` };
}
