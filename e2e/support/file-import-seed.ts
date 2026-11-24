import type { APIRequestContext } from "@playwright/test";
import { authHeaders, testName } from "./auth";
import { call } from "./register-seed";

/**
 * FI-4 seeds, API only, in a ZZ-TEST plan (the sample files are dated November 2026):
 * - `plain`: ZZ Checking, Starting Balance 0 on 2026-11-01;
 * - `cutoff`: the Starting Balance is dated 2026-11-11, so the 11/10 row of sample.csv is skipped;
 * - `worked`: Starting Balance +530.00 on 11/01 (cleared), hand-entered Rent -260.00 on 11/05 and Corner Market
 *   -20.00 on 11/15, both uncleared.
 * Every seed also has an open ZZ Savings, and `closed` adds a closed ZZ Old account.
 */
export type FileImportSeedKind = "plain" | "cutoff" | "worked";

export async function seedFileImport(
  request: APIRequestContext,
  opts: { kind?: FileImportSeedKind; closed?: boolean } = {},
) {
  const kind = opts.kind ?? "plain";
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("file-import"),
  });
  const plan = budget.id as string;
  const open = async (name: string, type: string, balance: number, date: string) =>
    (await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, { name, type, balance, date }))
      .account.id as string;
  const checking = await open(
    "ZZ Checking",
    "checking",
    kind === "worked" ? 530000 : 0,
    kind === "cutoff" ? "2026-11-11" : "2026-11-01",
  );
  const savings = await open("ZZ Savings", "savings", 0, "2026-11-01");
  let old: string | null = null;
  if (opts.closed) {
    old = await open("ZZ Old", "checking", 0, "2026-11-01");
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts/${old}/close`, {});
  }
  if (kind === "worked") {
    const hand = (payee_name: string, amount: number, date: string) =>
      call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: checking,
        date,
        amount,
        payee_name,
      });
    await hand("ZZ Rent", -260000, "2026-11-05");
    await hand("Corner Market", -20000, "2026-11-15");
  }
  return { plan, checking, savings, old };
}

/** Imports `file` into `account` through the Worker's own API (preview, then import), as the dialogs do. */
export async function importViaApi(
  request: APIRequestContext,
  plan: string,
  account: string,
  file: { name: string; buffer: Buffer },
  today: string,
) {
  const base = `/api/v1/budgets/${plan}/accounts/${account}/imports`;
  const prev = await request.post(`${base}/preview`, {
    headers: await authHeaders(),
    multipart: {
      file: { name: file.name, mimeType: "text/csv", buffer: file.buffer },
      options: JSON.stringify({ today }),
    },
  });
  const p = (await prev.json()).data;
  return call(request, "POST", base, { file_id: p.file_id, options: { ...p.options, today } });
}
