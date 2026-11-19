import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openManagePayees } from "./support/manage-payees-seed";
import { realClick } from "./support/real-click";
import { addRuleVia, rulesOf, seedRulesPlan } from "./support/rename-rules-seed";

type Seed = Awaited<ReturnType<typeof seedRulesPlan>>;
type Box = ReturnType<Page["locator"]>;

const open = async (page: Page, s: Seed) => {
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  return openManagePayees(page, s.name);
};
const btn = (d: Box, name: string) => d.getByRole("button", { name, exact: true });
const pick = (d: Box, name: string) => btn(d, `Select ${name}`);
const tick = (d: Box, name: string) =>
  d.getByRole("checkbox", { name: `Check ${name}`, exact: true });
const gear = (d: Box) => d.getByRole("img", { name: "Renaming rules applied", exact: true });
const heading = (d: Box) => d.getByRole("heading", { name: "Renaming", exact: true });

test("1 the card: add Contains and Is, the gear, a refused rule, remove both", async ({
  page,
  request,
}) => {
  const s = await seedRulesPlan(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe"));
  await expect(heading(d)).toBeVisible();
  await expect(
    d.getByText("Imported payees that match these rules will be renamed.", { exact: true }),
  ).toBeVisible();
  await expect(gear(d)).toHaveCount(0);
  const empty = d.getByRole("textbox", { name: "New rule text", exact: true });
  await expect(empty).toHaveValue("");
  await expect(btn(d, "Add a renaming rule")).toBeVisible();

  // Contains, saved with the + button.
  await empty.fill("zz cafe");
  await realClick(page, btn(d, "Add a renaming rule"));
  await expect
    .poll(async () => (await rulesOf(request, s.plan, s.ids["ZZ Cafe"] as string)).length)
    .toBe(1);
  await expect(d.getByRole("textbox", { name: "Rule text", exact: true })).toHaveValue("zz cafe");
  await expect(gear(d)).toHaveCount(1);

  // Is, saved with Tab (blur).
  await d.getByRole("combobox", { name: "Rule type", exact: true }).last().selectOption("is");
  await empty.fill("ZZ BANK CAFE 12");
  await empty.press("Tab");
  await expect
    .poll(async () =>
      (await rulesOf(request, s.plan, s.ids["ZZ Cafe"] as string)).map((r) => [r.kind, r.text]),
    )
    .toEqual([
      ["contains", "zz cafe"],
      ["is", "ZZ BANK CAFE 12"],
    ]);
  await expect(d.getByRole("textbox", { name: "Rule text", exact: true })).toHaveCount(2);
  await expect(empty).toHaveValue("");

  // The same rule again is refused, in the card.
  await d.getByRole("combobox", { name: "Rule type", exact: true }).last().selectOption("is");
  await empty.fill("zz bank cafe 12");
  await realClick(page, btn(d, "Add a renaming rule"));
  await expect(
    d.getByRole("alert").filter({ hasText: "This payee already has this renaming rule" }),
  ).toBeVisible();
  expect(await rulesOf(request, s.plan, s.ids["ZZ Cafe"] as string)).toHaveLength(2);
  await empty.fill("");

  // A saved row's text changes on blur.
  const first = d.getByRole("textbox", { name: "Rule text", exact: true }).first();
  await first.fill("zz cafe two");
  await first.press("Enter");
  await expect
    .poll(async () => (await rulesOf(request, s.plan, s.ids["ZZ Cafe"] as string))[0]?.text)
    .toBe("zz cafe two");

  // Remove both: the API agrees and the gear goes.
  await realClick(page, btn(d, "Remove renaming rule").first());
  await expect(d.getByRole("textbox", { name: "Rule text", exact: true })).toHaveCount(1);
  await realClick(page, btn(d, "Remove renaming rule").first());
  await expect(d.getByRole("textbox", { name: "Rule text", exact: true })).toHaveCount(0);
  await expect
    .poll(async () => (await rulesOf(request, s.plan, s.ids["ZZ Cafe"] as string)).length)
    .toBe(0);
  await expect(gear(d)).toHaveCount(0);
});

test("2 a hidden payee has the card, a transfer payee has none, two selected show the sentence", async ({
  page,
  request,
}) => {
  const s = await seedRulesPlan(request);
  await addRuleVia(request, s.plan, s.ids["ZZ Cafe"] as string, "is", "ZZ BANK CAFE 12");
  const d = await open(page, s);
  await expect(gear(d)).toHaveCount(1);
  await realClick(
    page,
    btn(d, "Expand Hidden Payees").or(btn(d, "Collapse Hidden Payees")).first(),
  );
  await realClick(page, pick(d, "ZZ Gone"));
  await expect(heading(d)).toBeVisible();

  await realClick(page, btn(d, "Expand Transfer Payees"));
  await realClick(page, pick(d, "Transfer : ZZ Card"));
  await expect(heading(d)).toHaveCount(0);

  const sentence =
    "One or more of these payees have renaming rules. Deleting them will also delete their rules.";
  await realClick(page, pick(d, "ZZ Other"));
  await realClick(page, tick(d, "ZZ Cafe"));
  await expect(d.getByText(sentence, { exact: true })).toBeVisible();
  await realClick(page, tick(d, "ZZ Cafe"));
  await expect(d.getByText(sentence, { exact: true })).toHaveCount(0);
});

test("3 every control is reachable by keyboard, and the card fits at 1024 by 700", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  const s = await seedRulesPlan(request);
  await addRuleVia(request, s.plan, s.ids["ZZ Cafe"] as string, "contains", "zz cafe");
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe"));
  const kind = d.getByRole("combobox", { name: "Rule type", exact: true });
  await expect(kind).toHaveCount(2);
  await kind.first().focus();
  for (const want of [
    d.getByRole("textbox", { name: "Rule text", exact: true }),
    btn(d, "Remove renaming rule"),
    kind.last(),
    d.getByRole("textbox", { name: "New rule text", exact: true }),
    btn(d, "Add a renaming rule"),
  ]) {
    await page.keyboard.press("Tab");
    await expect(want).toBeFocused();
  }
  const card = d.locator(".mp-rules");
  const box = await card.boundingBox();
  const dialog = await d.boundingBox();
  expect(box && dialog && box.x >= dialog.x && box.x + box.width <= dialog.x + dialog.width).toBe(
    true,
  );
  const rows = await d
    .locator(".mp-rule-row")
    .evaluateAll((els) =>
      els.map((e) => (e.parentElement?.getBoundingClientRect().width ?? 0) - e.scrollWidth),
    );
  // scrollWidth is a rounded integer, the parent's width is fractional: one pixel of rounding is no overflow.
  expect(
    rows.every((w) => w >= -1),
    `slack of each row: ${rows}`,
  ).toBe(true);
});
