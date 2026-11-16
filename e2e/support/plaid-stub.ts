import type { Page, Route } from "@playwright/test";

/** Plaid's own Link script (kept in step with apps/web/src/shell/plaidLink.ts). */
const PLAID_LINK_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type LinkBehaviour =
  | { success: { public_token: string; institution: { name: string; institution_id: string } } }
  | { exit: { display_message: string | null } };

/**
 * Replaces Plaid's script with a stub whose `Plaid.create(config).open()` calls onSuccess or onExit.
 * Plaid's own frame cannot be driven reliably in a headless gate. The non-function config is kept on
 * `window.__plaidConfig` for assertions.
 */
export async function stubPlaidLink(page: Page, behaviour: LinkBehaviour) {
  const js = `window.Plaid = { create(cfg) {
    window.__plaidConfig = { token: cfg.token, receivedRedirectUri: cfg.receivedRedirectUri };
    return { open() { setTimeout(() => {
      const b = ${JSON.stringify(behaviour)};
      if (b.success) cfg.onSuccess(b.success.public_token, { institution: b.success.institution });
      else cfg.onExit(b.exit.display_message ? { display_message: b.exit.display_message } : null, {});
    }, 30); } };
  } };`;
  await page.route(PLAID_LINK_SRC, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: js }),
  );
}

export interface FakeInstitution {
  institution_id: string;
  name: string;
  country: string;
  url: string | null;
  logo: string | null;
}
export const fakeInstitution = (
  i: number,
  over: Partial<FakeInstitution> = {},
): FakeInstitution => ({
  institution_id: `ins_test_${i}`,
  name: `ZZ Test Bank ${i}`,
  country: "United States",
  url: `https://www.zz-test-bank-${i}.example/`,
  logo: null,
  ...over,
});

export interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

type Answer<T> = { status: number; body?: unknown } | T;
const isStatus = (a: unknown): a is { status: number } =>
  typeof a === "object" && a !== null && "status" in a;

/** Stubs the institutions and bank-connections API with fake banks and records every request. */
export async function stubApi(
  page: Page,
  opts: {
    popular?: Answer<FakeInstitution[]>;
    search?: (query: string) => Answer<FakeInstitution[]>;
    linkToken?: string;
    create?: unknown;
  },
) {
  const requests: RecordedRequest[] = [];
  const reply = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const list = (route: Route, a: Answer<FakeInstitution[]>) =>
    isStatus(a)
      ? reply(
          route,
          a.status,
          a.body ?? { error: { id: String(a.status), name: "x", detail: "x" } },
        )
      : reply(route, 200, { data: { institutions: a } });

  await page.route(/\/api\/v1\/institutions/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    requests.push({ method: req.method(), url: req.url(), body: null });
    if (url.pathname.endsWith("/popular")) return list(route, opts.popular ?? []);
    return list(route, opts.search ? opts.search(url.searchParams.get("query") ?? "") : []);
  });
  await page.route(/\/api\/v1\/bank-connections/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    requests.push({ method: req.method(), url: req.url(), body: req.postDataJSON() });
    if (url.pathname.endsWith("/link-token")) {
      return reply(route, 200, {
        data: { link_token: opts.linkToken ?? "link-test", expiration: "2030-01-01T00:00:00Z" },
      });
    }
    return reply(route, 201, opts.create ?? {});
  });
  return requests;
}
