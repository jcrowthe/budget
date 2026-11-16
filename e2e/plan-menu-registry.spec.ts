import { expect, test } from "@playwright/test";
import { placeMenu, placeSubmenu } from "../apps/web/src/shell/menuPlacement";
import {
  collectPlanMenuActions,
  PLAN_MENU,
  type PlanMenuAction,
  resolveEntry,
} from "../apps/web/src/shell/planMenuEntries";

const def = (id: string) => {
  const d = PLAN_MENU.flatMap((s) => s.entries).find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};

test("a throwaway action enables its entry, and removing it disables it again", () => {
  const calls: unknown[] = [];
  const action: PlanMenuAction = { entry: "edit-flags", run: (ctx) => calls.push(ctx) };
  const withIt = collectPlanMenuActions({ "./x.ts": { action } });
  const r = resolveEntry(def("edit-flags"), withIt, true);
  expect(r.enabled).toBe(true);
  const ctx = { budgetId: "p", navigate: () => {} };
  if (r.action && "run" in r.action) r.action.run(ctx);
  expect(calls).toEqual([ctx]);
  expect(resolveEntry(def("edit-flags"), collectPlanMenuActions({}), true).enabled).toBe(false);
  // Entries about the open plan stay disabled while no plan is open.
  expect(resolveEntry(def("edit-flags"), withIt, false).enabled).toBe(false);
});

test("unknown, duplicate and built-in ids throw", () => {
  const run = () => {};
  expect(() =>
    collectPlanMenuActions({ "./a.ts": { action: { entry: "nope" as never, run } } }),
  ).toThrow(/unknown entry nope in \.\/a\.ts/);
  expect(() =>
    collectPlanMenuActions({ "./a.ts": { action: { entry: "log-out" as never, run } } }),
  ).toThrow(/unknown entry log-out/);
  expect(() =>
    collectPlanMenuActions({
      "./a.ts": { action: { entry: "edit-flags", run } },
      "./b.ts": { action: { entry: "edit-flags", run } },
    }),
  ).toThrow(/edit-flags registered twice \(\.\/a\.ts, \.\/b\.ts\)/);
});

test("placement", () => {
  expect(placeMenu({ left: 8, top: 8, right: 251, bottom: 54 }, 900)).toEqual({
    left: 8,
    top: 62,
    maxHeight: 822,
  });
  const menu = { left: 8, top: 62, right: 248, bottom: 500 };
  const row = { left: 12, top: 100, right: 244, bottom: 133 };
  const size = { width: 200, height: 150 };
  // Source (Designer, 1440\u00d7900): left = Open Plan row.right, top = row.top.
  expect(placeSubmenu(menu, row, size, 1440, 900)).toEqual({ left: 244, top: 100, maxHeight: 884 });
  // Flip to the left of the menu when there is no room on the right.
  expect(
    placeSubmenu({ ...menu, left: 300, right: 540 }, { ...row, right: 540 }, size, 700, 900).left,
  ).toBe(100);
  // Shift when neither side fits.
  expect(placeSubmenu(menu, row, { width: 400, height: 150 }, 640, 900).left).toBe(232);
  // Vertical clamp.
  expect(placeSubmenu(menu, { ...row, top: 450 }, size, 1440, 480).top).toBe(322);
  expect(placeSubmenu(menu, { ...row, top: 2 }, size, 1440, 900).top).toBe(8);
});
