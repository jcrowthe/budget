import type { ReactElement } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "./shell/AppShell";
import { PlanFallbackRedirect, PlanIndexRedirect, PlanScope } from "./shell/PlanScope";

// Every module in pages/ exports `page: { path, element }`. Paths under `/:budgetId/` render inside
// PlanScope (plan resolved, not-found handled, open recorded); the others render directly in AppShell.
const pageModules = import.meta.glob<{ page: { path: string; element: ReactElement } }>(
  "./pages/*.tsx",
  { eager: true },
);

const PLAN_PREFIX = "/:budgetId/";
const others: RouteObject[] = [];
const scoped: RouteObject[] = [];
for (const k of Object.keys(pageModules).sort()) {
  const page = pageModules[k]?.page;
  if (!page) continue;
  if (page.path.startsWith(PLAN_PREFIX)) {
    scoped.push({ path: page.path.slice(PLAN_PREFIX.length), element: page.element });
  } else {
    others.push({ path: page.path, element: page.element });
  }
}

const planRoute: RouteObject = {
  path: "/:budgetId",
  element: <PlanScope />,
  children: [
    { index: true, element: <PlanIndexRedirect /> },
    ...scoped,
    { path: "*", element: <PlanFallbackRedirect /> },
  ],
};

export const router = createBrowserRouter([
  { element: <AppShell />, children: [...others, planRoute] },
]);
