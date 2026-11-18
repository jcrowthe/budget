import { expect, test } from "./fixtures";
import { dialogNamed, openList, setup } from "./support/manage-connections-seed";
import { realClick } from "./support/real-click";

// The base64 of a valid 1x1 PNG.
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("EXF-798 the bank's logo loads in the list and in the detail", async ({ page, request }) => {
  const messages: string[] = [];
  page.on("console", (m) => messages.push(m.text()));
  await setup(page, request, (z) => [z.connection], { zz: { logo: PNG_1PX } });
  const dialog = await openList(page);
  const listImg = dialog.locator(".mc-logo img").first();
  await expect(listImg).toBeVisible();
  const loaded = (i: HTMLImageElement) => i.complete && i.naturalWidth;
  await expect.poll(() => listImg.evaluate(loaded)).toBeGreaterThan(0);

  await realClick(page, dialog.getByRole("button", { name: "ZZ Bank", exact: true }));
  const detail = dialogNamed(page, "ZZ Bank");
  const detailImg = detail.locator(".mc-bank-row .mc-logo img").first();
  await expect(detailImg).toBeVisible();
  await expect.poll(() => detailImg.evaluate(loaded)).toBeGreaterThan(0);
  expect(messages.filter((t) => t.includes("ERR_INVALID_URL"))).toEqual([]);
});
