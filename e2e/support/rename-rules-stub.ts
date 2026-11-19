import type { Page } from "@playwright/test";

/**
 * EXF-467: the browser's stand-in for imported rows. No real import can be made (no Plaid, no writes to the
 * database from outside the server), so each row is a real hand row made through the API, and the list answers
 * dress it as an import in the forms the Worker gives these fields (`apps/worker/src/services/transactions.ts:41-62`
 * `transactionToApi`: `import_id`, `imported_payee`, `bank_description`, `import_payee_name` as strings, `source`
 * "plaid", `matched` false, and `match_details` null from the detail mapping); every other field keeps the server's
 * own value. Only GETs of a transactions list are answered here; an edit goes to the real server.
 */
export type DressedImport = {
  id: string;
  importPayeeName: string;
  bankDescription: string;
  importedPayee: string;
};

export async function stubRenameRulesImports(page: Page, rows: DressedImport[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  await page.route(/\/transactions(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    const list = body?.data?.transactions as Record<string, unknown>[] | undefined;
    if (!Array.isArray(list)) return route.fulfill({ response: res, json: body });
    body.data.transactions = list.map((t) => {
      const d = byId.get(t.id as string);
      if (!d) return t;
      return {
        ...t,
        import_id: `zz-imp-${d.id}`,
        imported_payee: d.importedPayee,
        bank_description: d.bankDescription,
        import_payee_name: d.importPayeeName,
        source: "plaid",
        matched: false,
        match_details: null,
      };
    });
    await route.fulfill({ response: res, json: body });
  });
}
