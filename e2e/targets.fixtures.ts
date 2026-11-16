import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { panel, type Seed } from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";

export { realClick } from "./support/real-click";

/** The UTC date of a moment, YYYY-MM-DD (the browsers of these specs run in UTC unless a spec says otherwise). */
export const utcToday = (clockMs: number) => new Date(clockMs).toISOString().slice(0, 10);
export const firstOfMonth = (iso: string, offset = 0) => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
};
export const lastOfMonth = (iso: string, offset = 0) => {
  const d = new Date(`${firstOfMonth(iso, offset + 1)}T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
/** 2026-12-01 gives 12/01/2026 */
export const entryDate = (iso: string) =>
  `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
export const money = (milli: number) =>
  `$${(milli / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
};
export const monthName = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

export const MONTHLY = { cadence: "monthly", behavior: "set_aside", amount: 100000 };

export async function putTarget(
  request: APIRequestContext,
  s: Seed,
  category: string,
  body: Record<string, unknown>,
  today: string,
) {
  const res = await request.put(
    `/api/v1/budgets/${s.id}/categories/${s.cat[category]}/target?today=${today}`,
    { headers: await authHeaders(), data: body },
  );
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data.target;
}

/** One category of a month read with the owner's date. */
export async function readCategory(
  request: APIRequestContext,
  s: Seed,
  category: string,
  month: string,
  today: string,
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
): Promise<any> {
  const res = await request.get(`/api/v1/budgets/${s.id}/months/${month}?today=${today}`, {
    headers: await authHeaders(),
  });
  const d = (await res.json()).data;
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
  return d.groups.flatMap((g: any) => g.categories).find((c: any) => c.id === s.cat[category]);
}

export async function mcpCall(
  request: APIRequestContext,
  tool: string,
  args: Record<string, unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
): Promise<any> {
  const headers = await authHeaders({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  });
  const rpc = async (method: string, params: unknown, id: number) => {
    const res = await request.post("/mcp", {
      headers,
      data: { jsonrpc: "2.0", id, method, params },
    });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line ? line.slice(5) : text);
  };
  await rpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
    1,
  );
  const r = await rpc("tools/call", { name: tool, arguments: args }, 2);
  expect(r.result.isError, JSON.stringify(r.result)).toBeFalsy();
  return r.result.structuredContent;
}

/** The control's centre is the topmost element there (nothing covers it). Does not click. */
export async function expectTopmost(loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("not visible");
  expect(
    await loc.evaluate(
      (el, [x, y]) => {
        const h = document.elementFromPoint(x as number, y as number);
        return !!h && (h === el || el.contains(h) || h.contains(el));
      },
      [b.x + b.width / 2, b.y + b.height / 2],
    ),
  ).toBe(true);
}

export const card = (page: Page) =>
  panel(page).locator(".panel-card", { has: page.locator("#panel-target") });
export const form = (page: Page) => panel(page).locator(".target-form");
