import type { MonthGroupDetail } from "@budget/schema/months";
import { type CategoryMenu, categoryMenu } from "@budget/schema/register";

/**
 * What the category list shows for the typed text: `categoryMenu`, and with no `readyToAssign` the "Inflow" group
 * (Ready to Assign) left out, as a Plan picker that does not offer it. Pure.
 */
export function categoryListMenu(
  groups: readonly MonthGroupDetail[],
  readyToAssign: number | undefined,
  text: string,
): CategoryMenu {
  const menu = categoryMenu(groups, readyToAssign ?? 0, text);
  if (readyToAssign !== undefined) return menu;
  const kept = menu.groups
    .map((g) => ({ name: g.name, rows: g.rows.filter((r) => r.kind !== "rta") }))
    .filter((g) => g.rows.length > 0);
  const flat = kept.flatMap((g) => g.rows);
  return { groups: kept, flat, empty: flat.length === 0 };
}
