import { expect, test } from "./fixtures";
import { dialogNamed, openDetail, posts } from "./support/manage-connections-seed";
import { realClick } from "./support/real-click";
import { refreshState, syncs } from "./support/sync-refresh-state";

test.use({ viewport: { width: 1024, height: 700 } });

test("18 at 1024×700 the new bank account's row and the Link Account choice lie in the window", async ({
  page,
  request,
}) => {
  const inside = async (loc: ReturnType<typeof page.locator>) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error("not visible");
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1024);
    expect(b.y + b.height).toBeLessThanOrEqual(700);
  };
  const s = await refreshState(page, request, {}, true);
  await expect.poll(() => syncs(s).length).toBe(1);
  const detail = await openDetail(page, "ZZ Bank");
  const row = detail.getByRole("button", { name: "ZZ Rewards – 4321", exact: true });
  await inside(row);
  await realClick(page, row);
  const options = dialogNamed(page, "ZZ Rewards – 4321");
  await inside(options.getByRole("button", { name: "Link to an Existing Account", exact: true }));
  await inside(options.getByRole("button", { name: "Add as a new Account", exact: true }));
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  await realClick(
    page,
    page.locator(".acct-connection-strip").getByRole("button", { name: "Relink", exact: true }),
  );
  const dialog = dialogNamed(page, "Link Account");
  await expect(dialog).toBeVisible();
  const choice = dialog.getByRole("button", { name: /ZZ Rewards/ });
  await inside(choice);
  await realClick(page, choice);
  const link = () => posts(s.stub.requests, "POST", /\/accounts\/[^/]+\/link$/);
  await expect.poll(() => link().length).toBe(1);
  expect(link()[0]?.body).toMatchObject({ bank_account_id: s.rewards.id });
  await expect(page.locator(".acct-connection-strip")).toHaveCount(0);
});
