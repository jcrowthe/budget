import type { ReactElement } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "./shell/AppShell";

// Every module in pages/ exports `page: { path, element }`.
const pageModules = import.meta.glob<{ page: { path: string; element: ReactElement } }>(
  "./pages/*.tsx",
  { eager: true },
);

const children: RouteObject[] = Object.keys(pageModules)
  .sort()
  .flatMap((k) => {
    const page = pageModules[k]?.page;
    return page ? [{ path: page.path, element: page.element }] : [];
  });

export const router = createBrowserRouter([{ element: <AppShell />, children }]);
