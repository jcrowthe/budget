import { Outlet } from "react-router";
import { ShortcutsHost } from "../shortcuts/ShortcutsHost";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <ShortcutsHost />
    </div>
  );
}
