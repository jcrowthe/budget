import type { Page, Route } from "@playwright/test";

/**
 * Holds the real answer of every request `match` accepts for `ms` before passing it on: the request is made, its
 * response waits. Reproduces a slow read that is still in flight when the page changes the same data.
 */
export async function delayRoute(page: Page, match: (url: URL, route: Route) => boolean, ms: number) {
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "GET" || !match(new URL(req.url()), route)) return route.fallback();
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, ms));
      await route.fulfill({ response });
    },
  );
}
