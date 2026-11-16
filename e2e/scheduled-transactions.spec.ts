import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { call, realClick, seed, TODAY, txs } from "./support/register-seed";
import {
  addDays,
  CLOCKS,
  createSched,
  enterDueApi,
  fixClock,
  listSched,
  mmddyyyy,
  schedStatus,
} from "./support/scheduled-seed";

// Every date here is relative to the browser's fixed clock "D" (local noon), which the app sends as `today`.
// Nothing here is compared with the source app: its test plan has no scheduled transaction.

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const date = (page: Page) => page.getByRole("textbox", { name: "Date", exact: true });
const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const memo = (page: Page) => page.getByRole("textbox", { name: "Memo", exact: true });
const outflow = (page: Page) => page.getByRole("textbox", { name: "Outflow", exact: true });
const category = (page: Page) => page.getByRole("combobox", { name: "Category", exact: true });
const repeat = (page: Page) => page.getByRole("combobox", { name: "Repeat", exact: true });
const calendar = (page: Page) => page.getByRole("dialog", { name: "Calendar", exact: true });
const header = (page: Page) => button(page, "Scheduled Transactions");
const schedRows = (page: Page) => page.locator("tr[data-scheduled]");
const schedRow = (page: Page, text: string) => schedRows(page).filter({ hasText: text });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection actions" });
const balance = (page: Page, key: string) => page.locator(`[data-balance=${key}] .acct-amount`);
const realRow = (page: Page, text: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: text });

const LABELS = [
  "Never",
  "Daily",
  "Weekly",
  "Every other week",
  "Twice a month",
  "Every 4 weeks",
  "Monthly",
  "Every other month",
  "Every 3 months",
  "Every 4 months",
  "Twice a year",
  "Yearly",
  "Every other year",
];

async function openRegister(page: Page, s: { plan: string; checking: string }, day: string) {
  await fixClock(page, day);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.getByRole("button", { name: "Add Transaction", exact: true })).toBeVisible();
}

async function addRow(
  page: Page,
  o: {
    payee: string;
    outflow: string;
    date: string;
    repeat?: string;
    memo?: string;
    category?: string;
  },
) {
  await realClick(page, button(page, "Add Transaction"));
  await expect(date(page)).toBeFocused();
  await date(page).fill(mmddyyyy(o.date));
  if (o.repeat) await repeat(page).selectOption(o.repeat);
  await payee(page).fill(o.payee);
  await outflow(page).fill(o.outflow);
  if (o.memo) await memo(page).fill(o.memo);
  if (o.category) {
    await category(page).fill(o.category);
    await page.getByRole("option", { name: o.category }).first().click();
  }
  // Leaves the date field, so the calendar is closed and cannot cover Save.
  await memo(page).focus();
  await realClick(page, button(page, "Save"));
}

async function selectSched(page: Page, text: string) {
  await realClick(page, schedRow(page, text).locator("td[data-field=payee]"));
  await expect(
    schedRow(page, text).getByRole("checkbox", { name: "Select transaction", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
}

const fits = (l: Locator) => l.evaluate((e) => e.scrollWidth <= e.clientWidth);

test("the Repeat select lists the 13 options in order, Never selected; a real row has none (497 AC1)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: "2026-11-10",
    amount: -5000,
    payee_name: "ZZ-TEST Real Row",
  });
  await openRegister(page, s, "2026-11-15");
  await realClick(page, button(page, "Add Transaction"));
  await expect(date(page)).toBeFocused();
  await expect(calendar(page)).toBeVisible();
  await expect(calendar(page).getByText("Repeat:", { exact: true })).toBeVisible();
  await expect(repeat(page).locator("option")).toHaveText(LABELS);
  await expect(repeat(page)).toHaveValue("never");
  await page.keyboard.press("Escape");
  await expect(page.locator(".entry-body")).toHaveCount(0);

  // A real row's edit row: no Repeat.
  const row = realRow(page, "ZZ-TEST Real Row");
  await realClick(page, row.locator("td[data-field=payee]"));
  await realClick(page, row.locator("td[data-field=payee]"));
  await expect(page.locator(".entry-body")).toHaveCount(1);
  await realClick(page, date(page));
  await expect(calendar(page)).toBeVisible();
  await expect(repeat(page)).toHaveCount(0);
});

for (const day of CLOCKS) {
  test(`a payee, outflow 800.00 and a date 5 days ahead is a scheduled row; balances stay (497 AC2, ${day})`, async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    await openRegister(page, s, day);
    await expect(balance(page, "working")).toHaveText("$2,500.00");
    const ahead = addDays(day, 5);
    await addRow(page, { payee: "ZZ-TEST Landlord", outflow: "800.00", date: ahead });
    await expect
      .poll(async () => (await listSched(request, s.plan)).map((r) => r.date_next))
      .toEqual([ahead]);
    const [row] = await listSched(request, s.plan);
    expect(row?.amount).toBe(-800000);
    expect(row?.frequency).toBe("never");
    await expect(header(page)).toBeVisible();
    await expect(schedRows(page)).toHaveCount(1);
    await expect(schedRows(page).first()).toContainText(mmddyyyy(ahead));
    await expect(schedRows(page).first()).toContainText("ZZ-TEST Landlord");
    await expect(schedRows(page).first().locator(".scheduled-repeat")).toHaveCount(0);
    await expect(balance(page, "cleared")).toHaveText("$2,500.00");
    await expect(balance(page, "uncleared")).toHaveText("$0.00");
    await expect(balance(page, "working")).toHaveText("$2,500.00");
    expect(await txs(request, s.plan, s.checking)).toHaveLength(1);
  });
}

test("Repeat Monthly shows a repeat icon with the tooltip `Repeats monthly` (497 AC3)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openRegister(page, s, "2026-11-15");
  await addRow(page, {
    payee: "ZZ-TEST Landlord",
    outflow: "800.00",
    date: "2026-11-20",
    repeat: "monthly",
  });
  await expect(schedRows(page)).toHaveCount(1);
  const icon = schedRows(page).first().getByRole("img", { name: "Repeats monthly", exact: true });
  await expect(icon).toBeVisible();
  await icon.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Repeats monthly");
  expect((await listSched(request, s.plan))[0]?.frequency).toBe("monthly");
});

test("the header collapses and expands the section, and the state survives a reload (497 AC6)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await createSched(request, s.plan, "2026-11-15", {
    account_id: s.checking,
    date_first: "2026-11-20",
    amount: -1000,
    payee_name: "ZZ-TEST Collapse",
  });
  await openRegister(page, s, "2026-11-15");
  await expect(header(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-chevron=down]")).toBeVisible();
  await expect(schedRows(page)).toHaveCount(1);
  await realClick(page, header(page));
  await expect(header(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-chevron=right]")).toBeVisible();
  await expect(schedRows(page)).toHaveCount(0);
  await realClick(page, header(page));
  await expect(schedRows(page)).toHaveCount(1);
  await expect(page.locator("[data-chevron=down]")).toBeVisible();
  await realClick(page, header(page));
  await page.reload();
  await expect(header(page)).toHaveAttribute("aria-expanded", "false");
  await expect(schedRows(page)).toHaveCount(0);
});

test("a scheduled row has an empty cleared cell, no flag button and no image button (497 AC7)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await createSched(request, s.plan, "2026-11-15", {
    account_id: s.checking,
    date_first: "2026-11-20",
    frequency: "weekly",
    amount: -1000,
    payee_name: "ZZ-TEST Cells",
    flag_color: "red",
  });
  await openRegister(page, s, "2026-11-15");
  const row = schedRow(page, "ZZ-TEST Cells");
  await expect(row).toHaveCount(1);
  await expect(row.locator("td.cell-cleared")).toBeEmpty();
  await expect(row.locator("td.cell-cleared").getByRole("button")).toHaveCount(0);
  await expect(row.locator("td.cell-flag").getByRole("button")).toHaveCount(0);
  await expect(row.locator("td.cell-flag svg")).toHaveCount(1);
  // The register has no image button today, so none is drawn on a scheduled row either.
  await expect(row.getByRole("button", { name: /image/i })).toHaveCount(0);
});

test("edit a scheduled row (Cancel/Save, Repeat shown), then delete it with no prompt (497 AC8)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const made = await createSched(request, s.plan, "2026-11-15", {
    account_id: s.checking,
    date_first: "2026-11-25",
    frequency: "monthly",
    amount: -1000,
    payee_name: "ZZ-TEST Edit",
    memo: "old memo",
  });
  await openRegister(page, s, "2026-11-15");
  await selectSched(page, "ZZ-TEST Edit");
  await expect(bar(page).getByRole("button", { name: "1 Transaction", exact: true })).toBeVisible();
  // A second click on the selected row opens it.
  await realClick(page, schedRow(page, "ZZ-TEST Edit").locator("td[data-field=payee]"));
  await expect(page.locator(".entry-body")).toHaveCount(1);
  await expect(button(page, "Cancel")).toBeVisible();
  await expect(button(page, "Save")).toBeVisible();
  await realClick(page, date(page));
  await expect(repeat(page)).toHaveValue("monthly");
  await memo(page).fill("ZZ-TEST rent");
  await realClick(page, button(page, "Save"));
  await expect.poll(async () => (await listSched(request, s.plan))[0]?.memo).toBe("ZZ-TEST rent");
  const [after] = await listSched(request, s.plan);
  expect(after?.id).toBe(made.scheduled_transaction.id);
  expect(after?.date_next).toBe("2026-11-25");
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await expect(schedRow(page, "ZZ-TEST rent")).toHaveCount(1);

  await expect(bar(page)).toBeVisible();
  await realClick(page, bar(page).getByRole("button", { name: "More", exact: true }));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "More actions" })
      .getByRole("menuitem", { name: "Delete", exact: true }),
  );
  await expect.poll(async () => (await listSched(request, s.plan)).length).toBe(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(schedRows(page)).toHaveCount(0);
  await expect(header(page)).toHaveCount(0);
});

test("a far-future date and an empty category are accepted (497 AC9)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openRegister(page, s, "2026-11-15");
  await addRow(page, { payee: "ZZ-TEST Far", outflow: "5.00", date: "2032-12-31" });
  await expect.poll(async () => (await listSched(request, s.plan)).length).toBe(1);
  const [row] = await listSched(request, s.plan);
  expect(row?.date_next).toBe("2032-12-31");
  expect(row?.category_id).toBeNull();
  await expect(schedRows(page).first()).toContainText("12/31/2032");
  await expect(schedRows(page).first().locator("td[data-field=category]")).toHaveText("");
});

// Expected (scheduled date = D+10, series date after one Enter Now) for each clock.
const MONTHLY_STEP: Record<string, [string, string]> = {
  "2026-11-15": ["2026-11-25", "2026-12-25"],
  "2026-11-30": ["2026-12-10", "2027-01-10"],
  "2026-12-31": ["2027-01-10", "2027-02-10"],
};

for (const day of CLOCKS) {
  test(`Enter Now on a monthly series makes an approved row dated today and moves one month (499 AC1, ${day})`, async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    const [first, next] = MONTHLY_STEP[day] as [string, string];
    expect(first).toBe(addDays(day, 10));
    await createSched(request, s.plan, day, {
      account_id: s.checking,
      date_first: first,
      frequency: "monthly",
      amount: -25000,
      payee_name: "ZZ-TEST Enter",
      memo: "ZZ-TEST memo",
    });
    await openRegister(page, s, day);
    await selectSched(page, "ZZ-TEST Enter");
    await realClick(page, bar(page).getByRole("button", { name: "Enter Now", exact: true }));
    await expect
      .poll(
        async () =>
          (await txs(request, s.plan, s.checking)).filter((t) => t.payee_name === "ZZ-TEST Enter")
            .length,
      )
      .toBe(1);
    const real = (await txs(request, s.plan, s.checking)).find(
      (t) => t.payee_name === "ZZ-TEST Enter",
    );
    expect(real?.date).toBe(day);
    expect(real?.approved).toBe(true);
    expect(real?.cleared).toBe("uncleared");
    expect(real?.memo).toBe("ZZ-TEST memo");
    expect((await listSched(request, s.plan))[0]?.date_next).toBe(next);
    await expect(schedRows(page).first()).toContainText(mmddyyyy(next));
    await expect(realRow(page, "ZZ-TEST Enter")).toHaveCount(1);
  });
}

test("Enter Now on a one-off removes it and makes a real row dated today (499 AC2)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const made = await createSched(request, s.plan, "2026-11-15", {
    account_id: s.checking,
    date_first: "2026-11-18",
    amount: -7000,
    payee_name: "ZZ-TEST OneOff",
  });
  await openRegister(page, s, "2026-11-15");
  await selectSched(page, "ZZ-TEST OneOff");
  await realClick(page, bar(page).getByRole("button", { name: "Enter Now", exact: true }));
  await expect.poll(() => schedStatus(request, s.plan, made.scheduled_transaction.id)).toBe(404);
  await expect(schedRows(page)).toHaveCount(0);
  await expect(header(page)).toHaveCount(0);
  const real = (await txs(request, s.plan, s.checking)).filter(
    (t) => t.payee_name === "ZZ-TEST OneOff",
  );
  expect(real.map((t) => t.date)).toEqual(["2026-11-15"]);
  await expect(realRow(page, "ZZ-TEST OneOff")).toHaveCount(1);
});

for (const day of CLOCKS) {
  test(`a new weekly transaction dated today is a real unapproved row and a series due in 7 days (499 AC3, ${day})`, async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    await openRegister(page, s, day);
    await addRow(page, {
      payee: "ZZ-TEST Weekly",
      outflow: "10.00",
      date: day,
      repeat: "weekly",
    });
    await expect
      .poll(async () => (await listSched(request, s.plan)).map((r) => r.date_next))
      .toEqual([addDays(day, 7)]);
    const real = (await txs(request, s.plan, s.checking)).filter(
      (t) => t.payee_name === "ZZ-TEST Weekly",
    );
    expect(real.map((t) => [t.date, t.approved, t.cleared])).toEqual([[day, false, "uncleared"]]);
    await expect(schedRows(page)).toHaveCount(1);
    await expect(realRow(page, "ZZ-TEST Weekly")).toHaveCount(1);
  });
}

test("a weekly transaction dated 14 days ago makes one real row; missed ones are not entered (499 AC4)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const day = "2026-11-15";
  await openRegister(page, s, day);
  await addRow(page, {
    payee: "ZZ-TEST Missed",
    outflow: "10.00",
    date: addDays(day, -14),
    repeat: "weekly",
  });
  await expect
    .poll(async () => (await listSched(request, s.plan)).map((r) => r.date_next))
    .toEqual([addDays(day, 7)]);
  const real = (await txs(request, s.plan, s.checking)).filter(
    (t) => t.payee_name === "ZZ-TEST Missed",
  );
  expect(real.map((t) => t.date)).toEqual([addDays(day, -14)]);
  await expect(realRow(page, "ZZ-TEST Missed")).toHaveCount(1);
});

// Design doc, Acceptance cases 14 and 15: the literal dates of the case text, not dates relative to the clock.
for (const [ac, first] of [
  ["AC14", "2026-11-15"],
  ["AC15", "2026-11-01"],
] as const) {
  test(`Weekly, today 11/15/2026, dated ${mmddyyyy(first)}: ${first === "2026-11-15" ? "one real row on 11/15, approved false" : "one real row on 11/01, none on 11/08 or 11/15"}, date_next 2026-11-22 (499 ${ac})`, async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    await openRegister(page, s, "2026-11-15");
    const name = `ZZ-TEST Fixed ${ac}`;
    await addRow(page, { payee: name, outflow: "10.00", date: first, repeat: "weekly" });
    await expect
      .poll(async () => (await listSched(request, s.plan)).map((r) => r.date_next))
      .toEqual(["2026-11-22"]);
    const real = (await txs(request, s.plan, s.checking)).filter((t) => t.payee_name === name);
    expect(real.map((t) => [t.date, t.approved])).toEqual([[first, false]]);
    await expect(realRow(page, name)).toHaveCount(1);
  });
}

test("opening the register on the due day enters what is due once (499 AC5)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const created = "2026-11-15";
  const dueDay = "2026-11-16";
  await createSched(request, s.plan, created, {
    account_id: s.checking,
    date_first: dueDay,
    frequency: "weekly",
    amount: -3000,
    payee_name: "ZZ-TEST Due",
  });
  await openRegister(page, s, dueDay);
  await expect(realRow(page, "ZZ-TEST Due")).toHaveCount(1);
  const real = (await txs(request, s.plan, s.checking)).filter(
    (t) => t.payee_name === "ZZ-TEST Due",
  );
  expect(real.map((t) => [t.date, t.approved, t.cleared])).toEqual([[dueDay, false, "uncleared"]]);
  expect((await listSched(request, s.plan))[0]?.date_next).toBe(addDays(dueDay, 7));
  // A reload, and a second call, add nothing.
  await page.reload();
  await expect(realRow(page, "ZZ-TEST Due")).toHaveCount(1);
  expect((await enterDueApi(request, s.plan, dueDay)).entered).toEqual([]);
  expect(
    (await txs(request, s.plan, s.checking)).filter((t) => t.payee_name === "ZZ-TEST Due"),
  ).toHaveLength(1);
});

test("another plan's register never shows the first plan's scheduled rows, not for a frame (499 AC9)", async ({
  page,
  request,
}) => {
  const a = await seed(request);
  const b = await seed(request);
  await createSched(request, a.plan, TODAY, {
    account_id: a.checking,
    date_first: addDays(TODAY, 5),
    frequency: "monthly",
    amount: -1000,
    payee_name: "ZZ-TEST Alpha Only",
  });
  await page.goto(`/${a.plan}/accounts/${a.checking}`);
  await expect(schedRow(page, "ZZ-TEST Alpha Only")).toHaveCount(1);
  // The app's own navigation to the other plan, sampled on every animation frame for 2 s.
  const frames = await page.evaluate(
    ([url]) =>
      new Promise<{ frames: number; seen: number; log: string[] }>((resolve) => {
        // The app commits its first render of the other plan on the first DOM change after the
        // navigation; frames before it still show the page that was already painted.
        let committed = false;
        new MutationObserver((_m, o) => {
          committed = true;
          o.disconnect();
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
        history.pushState(null, "", url as string);
        dispatchEvent(new PopStateEvent("popstate"));
        let frames = 0;
        let seen = 0;
        const log: string[] = [];
        const start = performance.now();
        const tick = () => {
          frames++;
          if (committed && (document.body.textContent ?? "").includes("ZZ-TEST Alpha Only")) {
            seen++;
            log.push(`${frames}@${location.pathname.slice(-8)}`);
          }
          if (performance.now() - start < 2000) requestAnimationFrame(tick);
          else resolve({ frames, seen, log });
        };
        requestAnimationFrame(tick);
      }),
    [`/${b.plan}/accounts/${b.checking}`],
  );
  expect(frames.frames).toBeGreaterThan(10);
  expect(frames.log).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`/${b.plan}/accounts/${b.checking}$`));
  await expect(page.getByRole("button", { name: "Add Transaction", exact: true })).toBeVisible();
});

test("at 1024x700 nothing the section adds is cut, wrapped or overlapping (497 AC21)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1024, height: 700 });
  await createSched(request, s.plan, "2026-11-15", {
    account_id: s.checking,
    date_first: "2026-11-20",
    frequency: "everyOtherMonth",
    amount: -1000,
    payee_name: "ZZ-TEST Narrow",
  });
  await openRegister(page, s, "2026-11-15");
  const row = schedRow(page, "ZZ-TEST Narrow");
  await expect(row).toHaveCount(1);
  // The section header.
  const head = header(page);
  expect(await fits(head)).toBe(true);
  expect(await fits(page.locator(".scheduled-title"))).toBe(true);
  const hb = (await head.boundingBox()) as { x: number; width: number };
  const cb = (await page.locator(".scheduled-chevron").boundingBox()) as {
    x: number;
    width: number;
  };
  expect(cb.x + cb.width).toBeLessThanOrEqual(hb.x + hb.width);
  // A repeating row's date cell: the text, then the icon, inside the cell.
  const cell = row.locator("td.scheduled-date");
  expect(await fits(cell)).toBe(true);
  const text = (await cell.locator(".scheduled-date-text").boundingBox()) as {
    x: number;
    width: number;
    y: number;
    height: number;
  };
  const icon = (await cell.locator(".scheduled-repeat").boundingBox()) as {
    x: number;
    width: number;
    y: number;
    height: number;
  };
  const box = (await cell.boundingBox()) as { x: number; width: number };
  expect(text.x + text.width).toBeLessThanOrEqual(icon.x);
  expect(icon.x + icon.width).toBeLessThanOrEqual(box.x + box.width);
  expect(Math.abs(text.y + text.height / 2 - (icon.y + icon.height / 2))).toBeLessThan(text.height);
  // Its tooltip.
  await row.getByRole("img", { name: "Repeats every other month", exact: true }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveText("Repeats every other month");
  expect(await fits(tip)).toBe(true);
  const tb = (await tip.boundingBox()) as { x: number; width: number };
  expect(tb.x).toBeGreaterThanOrEqual(0);
  expect(tb.x + tb.width).toBeLessThanOrEqual(1024);
  // The Repeat select showing the longest label.
  await page.mouse.move(0, 0);
  await realClick(page, button(page, "Add Transaction"));
  await expect(date(page)).toBeFocused();
  await repeat(page).selectOption("everyOtherMonth");
  await expect(repeat(page).locator("option:checked")).toHaveText("Every other month");
  expect(await fits(repeat(page))).toBe(true);
  const sel = (await repeat(page).boundingBox()) as { x: number; width: number };
  const dlg = (await calendar(page).boundingBox()) as { x: number; width: number };
  expect(sel.x).toBeGreaterThanOrEqual(dlg.x);
  expect(sel.x + sel.width).toBeLessThanOrEqual(dlg.x + dlg.width);
  const label = (await calendar(page).getByText("Repeat:", { exact: true }).boundingBox()) as {
    x: number;
    width: number;
  };
  expect(label.x + label.width).toBeLessThanOrEqual(sel.x);
});

test("selecting one kind clears the other; the bar offers Enter Now and More's Delete; E enters both (497 AC22)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: "2026-11-10",
    amount: -5000,
    payee_name: "ZZ-TEST Real",
  });
  for (const n of ["One", "Two"]) {
    await createSched(request, s.plan, "2026-11-15", {
      account_id: s.checking,
      date_first: "2026-11-25",
      frequency: "monthly",
      amount: -1000,
      payee_name: `ZZ-TEST Sched ${n}`,
    });
  }
  await openRegister(page, s, "2026-11-15");
  await realClick(page, realRow(page, "ZZ-TEST Real").locator("td[data-field=payee]"));
  await expect(realRow(page, "ZZ-TEST Real").getByRole("checkbox")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await selectSched(page, "ZZ-TEST Sched One");
  await expect(realRow(page, "ZZ-TEST Real").getByRole("checkbox")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(bar(page).getByRole("button", { name: "1 Transaction", exact: true })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Enter Now", exact: true })).toBeEnabled();
  await expect(bar(page).getByRole("button", { name: "Categorize", exact: true })).toBeDisabled();
  await expect(bar(page).getByRole("button", { name: "Flag", exact: true })).toBeDisabled();
  await realClick(page, bar(page).getByRole("button", { name: "More", exact: true }));
  const menu = page.getByRole("menu", { name: "More actions" });
  for (const name of ["Duplicate", "Memo...", "Move to Account", "Export 1 Transaction"]) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // Selecting a real row again clears the scheduled one.
  await realClick(page, realRow(page, "ZZ-TEST Real").locator("td[data-field=payee]"));
  await expect(schedRow(page, "ZZ-TEST Sched One").getByRole("checkbox")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // Two scheduled rows, then E.
  await selectSched(page, "ZZ-TEST Sched One");
  await realClick(
    page,
    schedRow(page, "ZZ-TEST Sched Two").getByRole("checkbox", {
      name: "Select transaction",
      exact: true,
    }),
  );
  await expect(
    bar(page).getByRole("button", { name: "2 Transactions", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("e");
  await expect
    .poll(
      async () =>
        (await txs(request, s.plan, s.checking)).filter((t) =>
          t.payee_name?.startsWith("ZZ-TEST Sched"),
        ).length,
    )
    .toBe(2);
  expect((await listSched(request, s.plan)).map((r) => r.date_next)).toEqual([
    "2026-12-25",
    "2026-12-25",
  ]);
  await expect(bar(page)).toHaveCount(0);
});

test("Delete removes the selected scheduled rows; E typed in a field does nothing (497 AC22)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  for (const n of ["A", "B"]) {
    await createSched(request, s.plan, "2026-11-15", {
      account_id: s.checking,
      date_first: "2026-11-25",
      frequency: "monthly",
      amount: -1000,
      payee_name: `ZZ-TEST Key ${n}`,
    });
  }
  await openRegister(page, s, "2026-11-15");
  await selectSched(page, "ZZ-TEST Key A");
  // Open it for editing and type E into the memo field: nothing is entered.
  await realClick(page, schedRow(page, "ZZ-TEST Key A").locator("td[data-field=memo]"));
  await expect(memo(page)).toBeVisible();
  await memo(page).focus();
  await page.keyboard.type("e");
  await expect(memo(page)).toHaveValue("e");
  expect(await txs(request, s.plan, s.checking)).toHaveLength(1);
  expect(await listSched(request, s.plan)).toHaveLength(2);
  await realClick(page, button(page, "Cancel"));
  await expect(page.locator(".entry-body")).toHaveCount(0);

  // Cancel leaves the row selected.
  await expect(
    schedRow(page, "ZZ-TEST Key A").getByRole("checkbox", {
      name: "Select transaction",
      exact: true,
    }),
  ).toHaveAttribute("aria-checked", "true");
  await realClick(
    page,
    schedRow(page, "ZZ-TEST Key B").getByRole("checkbox", {
      name: "Select transaction",
      exact: true,
    }),
  );
  await expect(
    bar(page).getByRole("button", { name: "2 Transactions", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await listSched(request, s.plan)).length).toBe(0);
  await expect(schedRows(page)).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});
