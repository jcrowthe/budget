import type { APIRequestContext, FileChooser, Page } from "@playwright/test";
import { storeZip, utf8 } from "../../packages/schema/src/zip";
import { authHeaders, testName } from "./auth";
import { realClick } from "./real-click";

// Files for the Import Plan dialog's specs. Written by hand in the tickets' format with made-up names, or made by
// this app's own export (apiExport). Nothing here comes from the source app.
export type Rows = string[][];
type Upload = { name: string; mimeType: string; buffer: Buffer };

const BOM = "﻿";
const q = (v: string) => `"${v.replaceAll('"', '""')}"`;
const PLAN_HEADER = [
  "Month",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Assigned",
  "Activity",
  "Available",
];
const REGISTER_HEADER = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
];
const headerLine = (h: string[]) => h.map(q).join(",");

/** Plan file: columns 0-3 are text (quoted here), 4-6 are amounts written as given. */
export function planCsv(rows: Rows): string {
  const line = (r: string[]) => r.map((c, i) => (i < 4 ? q(c) : c)).join(",");
  return BOM + [headerLine(PLAN_HEADER), ...rows.map(line)].join("\r\n");
}
/** Register file: columns 8 and 9 are amounts written as given, the rest text. */
export function registerCsv(rows: Rows): string {
  const line = (r: string[]) => r.map((c, i) => (i === 8 || i === 9 ? c : q(c))).join(",");
  return BOM + [headerLine(REGISTER_HEADER), ...rows.map(line)].join("\r\n");
}

export function zipOf(name: string, files: { name: string; text: string }[]): Upload {
  const bytes = storeZip(
    files.map((f) => ({ name: f.name, data: utf8(f.text) })),
    "2026-11-15",
    "19:51",
  );
  return { name, mimeType: "application/zip", buffer: Buffer.from(bytes) };
}

export function pairOf(stamp: string, safeName: string, plan: string, register: string): Upload[] {
  const base = `${safeName} as of ${stamp}`;
  return [
    { name: `${base} - Plan.csv`, mimeType: "text/csv", buffer: Buffer.from(plan) },
    { name: `${base} - Register.csv`, mimeType: "text/csv", buffer: Buffer.from(register) },
  ];
}

/** This app's own export of a plan, through the API. */
export async function apiExport(request: APIRequestContext, planId: string): Promise<Upload> {
  const now = new Date().toISOString().slice(0, 16);
  const res = await request.get(`/api/v1/budgets/${planId}/export?now=${now}`, {
    headers: await authHeaders(),
  });
  const name =
    /filename="([^"]+)"/.exec(res.headers()["content-disposition"] ?? "")?.[1] ?? "export.zip";
  return { name, mimeType: "application/zip", buffer: Buffer.from(await res.body()) };
}

const STAMP = "2026-11-15 19-51";
const UNCLEAR_NAME = "Edge Plan";
const reg = (
  account: string,
  flag: string,
  date: string,
  payee: string,
  cat: string,
  out: string,
  inn: string,
): string[] => {
  const [group = "", name = ""] = cat.split(": ");
  return [account, flag, date, payee, cat, group, name, "", out, inn, "Cleared"];
};

/** Every day is 12 or less (the date format is unclear), flag "Tax", one Activity off by $1.00. */
export function unclearZip(): Upload {
  const plan = planCsv([
    ["Oct 2026", "Bills: Rent", "Bills", "Rent", "$100.00", "-$51.00", "$49.00"],
  ]);
  const register = registerCsv([
    reg("Edge Checking", "Tax", "10/05/2026", "Landlord", "Bills: Rent", "$50.00", "$0.00"),
    reg(
      "Edge Checking",
      "",
      "10/01/2026",
      "Starting Balance",
      "Inflow: Ready to Assign",
      "$0.00",
      "$1000.00",
    ),
  ]);
  return zipOf(`Budget Export - ${UNCLEAR_NAME} as of ${STAMP}.zip`, [
    { name: `${UNCLEAR_NAME} as of ${STAMP} - Plan.csv`, text: plan },
    { name: `${UNCLEAR_NAME} as of ${STAMP} - Register.csv`, text: register },
  ]);
}

/** Three accounts, four categories, `rows` Register lines (days 13 to 28, so the date format is clear). */
export function largePair(rows: number, accountName = "Big"): Upload[] {
  const accounts = [`${accountName} Checking`, `${accountName} Savings`, `${accountName} Cash`];
  const cats = ["Bills: Rent", "Everyday: Food", "Fun: Games", "Fun: Books"];
  const lines: string[][] = accounts.map((a) =>
    reg(a, "", "01/13/2026", "Starting Balance", "Inflow: Ready to Assign", "$0.00", "$100000.00"),
  );
  for (let i = 0; i < rows; i++) {
    const month = String((i % 9) + 1).padStart(2, "0");
    const day = String(13 + (i % 16)).padStart(2, "0");
    lines.push(
      reg(
        accounts[i % 3] as string,
        "",
        `${month}/${day}/2026`,
        `Shop ${i % 7}`,
        cats[i % 4] as string,
        `$${(1 + (i % 9)).toFixed(2)}`,
        "$0.00",
      ),
    );
  }
  return pairOf(STAMP, "Big Plan", planCsv([]), registerCsv(lines));
}

/** Two Register lines whose amounts are written with `symbol` before them (a symbol the app may not know). */
export function symbolPair(symbol: string): Upload[] {
  const lines = [
    reg(
      "Sym Checking",
      "",
      "01/13/2026",
      "Starting Balance",
      "Inflow: Ready to Assign",
      `${symbol}0.00`,
      `${symbol}1000.00`,
    ),
    reg("Sym Checking", "", "01/14/2026", "Shop", "Bills: Rent", `${symbol}12.50`, `${symbol}0.00`),
  ];
  return pairOf(STAMP, "Sym Plan", planCsv([]), registerCsv(lines));
}

/** One Register Outflow "$1,23.45" (quoted). */
export function badAmountPair(): Upload[] {
  const lines = [
    reg(
      "Bad Checking",
      "",
      "01/13/2026",
      "Starting Balance",
      "Inflow: Ready to Assign",
      "$0.00",
      "$1000.00",
    ),
    reg("Bad Checking", "", "01/14/2026", "Shop", "Bills: Rent", '"$1,23.45"', "$0.00"),
  ];
  return pairOf(STAMP, "Bad Plan", planCsv([]), registerCsv(lines));
}

/** The requests to `/budgets/import*` the page sends, as a live list. */
export function importRequests(page: Page): { url: string; method: string }[] {
  const seen: { url: string; method: string }[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/budgets/import"))
      seen.push({ url: r.url(), method: r.method() });
  });
  return seen;
}

/** Opens the file chooser with a real click on the drop zone and gives it the files. */
export async function chooseFiles(
  page: Page,
  files: Parameters<FileChooser["setFiles"]>[0],
): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    realClick(page, page.getByRole("button", { name: /Drop the files here/ })),
  ]);
  await chooser.setFiles(files);
}

/** /plans, then the Import Plan button with a real click. */
export async function openImport(page: Page): Promise<void> {
  await page.goto("/plans");
  await realClick(page, page.getByRole("button", { name: "Import Plan", exact: true }));
}

/**
 * A plan whose export is clear about its dates (every day after the 12th): a checking account, a card, a
 * category with money and a purchase on the card. API only; returns the plan's id and the card's.
 */
export async function seedClearPlan(request: APIRequestContext, label = "imp") {
  const call = async (method: "POST" | "PATCH", path: string, data: unknown) => {
    const res = await request.fetch(`/api/v1/budgets${path}`, {
      method,
      headers: await authHeaders(),
      data,
    });
    return (await res.json()).data;
  };
  const { budget } = await call("POST", "", { name: testName(label) });
  const plan = budget.id as string;
  const open = async (name: string, type: string, balance: number) =>
    (await call("POST", `/${plan}/accounts`, { name, type, balance, date: "2026-10-20" })).account
      .id as string;
  const checking = await open("ZZ-TEST Checking", "checking", 1000000);
  const visa = await open("ZZ-TEST Visa", "creditCard", 0);
  const group = (await call("POST", `/${plan}/category_groups`, { name: "ZZ Spending" }))
    .category_group.id as string;
  const groceries = (
    await call("POST", `/${plan}/categories`, { group_id: group, name: "ZZ Groceries" })
  ).category.id as string;
  await call("PATCH", `/${plan}/months/2026-10-01/categories/${groceries}`, { assigned: 335000 });
  await call("POST", `/${plan}/transactions`, {
    account_id: visa,
    date: "2026-10-21",
    amount: -35000,
    payee_name: "ZZ Market",
    category_id: groceries,
  });
  return { plan, checking, visa, groceries };
}

/**
 * Records the text fields of every FormData the page sends to `/budgets/import*` (the browser does not show a
 * multipart body to the test). Call before the first `goto`; read with `importForms`.
 */
export async function recordImportForms(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __importForms: Record<string, string>[] };
    w.__importForms = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.includes("/budgets/import") && init?.body instanceof FormData) {
        const fields: Record<string, string> = {};
        for (const [k, v] of init.body.entries()) if (typeof v === "string") fields[k] = v;
        fields.__files = init.body
          .getAll("file")
          .map((f) => (f as File).name)
          .join("|");
        w.__importForms.push(fields);
      }
      return real(input, init);
    };
  });
}

export const importForms = (page: Page): Promise<Record<string, string>[]> =>
  page.evaluate(
    () => (window as unknown as { __importForms: Record<string, string>[] }).__importForms ?? [],
  );
