import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
