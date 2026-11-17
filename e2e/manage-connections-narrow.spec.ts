import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fakeBankAccount, fakeConnection } from "./support/bank-link-stub";
import {
  addAccount,
  dialogNamed,
  openList,
  setup,
  sidebar,
} from "./support/manage-connections-seed";
import { realClick } from "./support/real-click";

test.use({ viewport: { width: 1024, height: 700 } });

const LONG = (n: number) => `ZZ ${String(n).padStart(2, "0")} ${"long name ".repeat(8)}`.trim();

async function inWindow(page: Page, loc: Locator) {
  const b = await loc.boundingBox();
  expect(b).not.toBeNull();
  const v = page.viewportSize() as { width: number; height: number };
  expect(b?.x).toBeGreaterThanOrEqual(0);
  expect(b?.y).toBeGreaterThanOrEqual(0);
  expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(v.width);
  expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(v.height);
}
const scrolls = (body: Locator) => body.evaluate((e) => e.scrollHeight > e.clientHeight);
/** Every text of `selector` that is cut ends in an ellipsis and holds its whole text in `title`; returns how many are cut. */
async function cut(scope: Locator, selector: string) {
  const r = await scope.locator(selector).evaluateAll((els) => ({
    cut: els.filter((e) => e.scrollWidth > e.clientWidth).length,
    bad: els
      .filter((e) => e.scrollWidth > e.clientWidth)
      .filter(
        (e) =>
          getComputedStyle(e).textOverflow !== "ellipsis" ||
          e.getAttribute("title") !== e.textContent,
      )
      .map((e) => e.textContent),
  }));
  expect(r.bad).toEqual([]);
  return r.cut;
}

async function crowded(page: Page, request: Parameters<typeof setup>[1]) {
  const many = Array.from({ length: 14 }, (_, i) =>
    fakeBankAccount({ name: LONG(i), mask: `${1000 + i}`, current_balance: 100000 + i }),
  );
  const big = fakeConnection({
    nickname: `ZZ ${"a hundred character nickname ".repeat(4)}`.slice(0, 100),
    display_id: "ffffff",
    accounts: many,
    last_synced_at: new Date(Date.now() - 3_600_000).toISOString(),
  });
  const others = Array.from({ length: 29 }, (_, i) =>
    fakeConnection({
      nickname: `ZZ Bank ${String(i + 1).padStart(2, "0")}`,
      display_id: (0xa00000 + i).toString(16),
      accounts: [fakeBankAccount({ name: `ZZ Only ${i}`, mask: "0001" })],
    }),
  );
  const s = await setup(page, request, (z) => [big, z.connection, ...others], {
    links: undefined,
  });
  for (let i = 0; i < 12; i++)
    await addAccount(request, s.budgetId, `ZZ Spare ${LONG(i)}`, "checking");
  await page.reload();
  await expect(
    sidebar(page)
      .getByRole("link", { name: /ZZ Spare/ })
      .first(),
  ).toBeVisible();
  return { s, big, many };
}

test("16 list, detail, options, choices, form and confirmations lie in the window; lists scroll; cut texts have titles", async ({
  page,
  request,
}) => {
  const { big } = await crowded(page, request);
  const list = await openList(page);
  await inWindow(page, list);
  expect(await scrolls(list.locator(".account-modal-body"))).toBe(true);
  await expect(list.getByRole("button", { name: "Add a New Bank Connection" })).toBeInViewport();
  expect(await cut(list, ".mc-line")).toBeGreaterThan(0);

  await realClick(page, list.getByRole("button", { name: big.nickname, exact: true }));
  const detail = dialogNamed(page, big.nickname);
  await inWindow(page, detail);
  expect(await scrolls(detail.locator(".account-modal-body"))).toBe(true);
  await expect(detail.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  expect(await cut(detail, ".mc-line, .mc-title h2")).toBeGreaterThan(0);

  const first = big.accounts[0];
  await realClick(
    page,
    detail.getByRole("button", { name: new RegExp(`^${first?.name.slice(0, 5)}`) }).first(),
  );
  const options = page.locator(".manage-connections");
  await inWindow(page, options);
  await realClick(page, options.getByRole("button", { name: "Link to an Existing Account" }));
  await expect(options.getByRole("button", { name: /^ZZ Spare/ })).toHaveCount(12);
  await inWindow(page, options);
  expect(await scrolls(options.locator(".account-modal-body"))).toBe(true);
  await cut(options, ".mc-line");
  await realClick(page, options.getByRole("button", { name: "Back" }));
  await realClick(page, options.getByRole("button", { name: "Add as a new Account" }));
  await expect(options.getByLabel("Account Nickname")).toBeVisible();
  await inWindow(page, options);
  await expect(options.getByRole("button", { name: "Add Account", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await realClick(page, options.getByRole("button", { name: "Reset", exact: true }));
  await inWindow(page, dialogNamed(page, "Reset Bank Connection"));
  await page.keyboard.press("Escape");
  await realClick(page, options.getByRole("button", { name: "Remove", exact: true }));
  await inWindow(page, dialogNamed(page, "Remove Bank Connection"));
});

test("16b the Unlink confirmation and 1440×900 list and detail lie in the window", async ({
  page,
  request,
}) => {
  await setup(page, request, (z) => [z.connection]);
  const list = await openList(page);
  await realClick(page, list.getByRole("button", { name: "ZZ Bank", exact: true }));
  const detail = dialogNamed(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "ZZ Checking – 0000", exact: true }));
  await realClick(
    page,
    page.locator(".manage-connections").getByRole("button", { name: "Unlink", exact: true }),
  );
  await inWindow(page, dialogNamed(page, "Unlink Account"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await inWindow(page, dialogNamed(page, "Unlink Account"));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await inWindow(page, page.locator(".manage-connections"));
  await page.keyboard.press("Escape");
  await inWindow(page, page.locator(".manage-connections"));
});
