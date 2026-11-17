import { Outlet } from "react-router";
import { ShortcutsHost } from "../shortcuts/ShortcutsHost";
import { PlanFormatsProvider } from "./plan-formats-context";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <PlanFormatsProvider>
      <div className="app">
        <Sidebar />
        <main className="main">
          <Outlet />
        </main>
        <ShortcutsHost />
      </div>
    </PlanFormatsProvider>
  );
}
