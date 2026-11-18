import type { Page } from "@playwright/test";

/**
 * EXF-464: the browser's stand-in for a bank import and its match. No real import can be made (no Plaid, no
 * writes to the database from outside), so both rows of a pair are real hand rows made through the API, and the
 * list answers dress them: while apart, `imp` is an import and `entry` a hand entry; while matched, `imp` is gone
 * and `entry` is the matched row. The dress has the forms the Worker gives these fields
 * (`apps/worker/src/services/transactions.ts:41-62` for the row, `:212-227` for `match_details`), and every other
 * field keeps the server's own value. A match or an unmatch of a known pair is answered here; anything else goes
 * to the real server.
 */
type Row = Record<string, unknown> & {
  id: string;
  amount: number;
  date: string;
  cleared: string;
  payee_name: string | null;
};
type Pair = { entry: string; imp: string; matched: boolean };
type Posted = { url: string; body: unknown };

const bank = (imp: Row) => ({
  import_id: `zz-imp-${imp.id}`,
  imported_payee: imp.payee_name,
  bank_description: imp.payee_name,
});

/** The import as the bank sent it: unapproved, source plaid. */
const asImport = (imp: Row): Row => ({
  ...imp,
  ...bank(imp),
  source: "plaid",
  approved: false,
  matched: false,
  match_details: null,
});

/** The entry after the match: the bank's amount and ids, cleared, approved, matched. */
const asMatched = (entry: Row, imp: Row): Row => ({
  ...entry,
  ...bank(imp),
  amount: imp.amount,
  cleared: "cleared",
  approved: true,
  source: null,
  matched: true,
  match_details: { date: imp.date, amount: imp.amount, payee_name: imp.payee_name },
});

const bucket = (r: Row) => (r.cleared === "uncleared" ? "uncleared" : "cleared");

export async function stubManualMatch(
  page: Page,
  pairs: { entry: string; imp: string; matched?: boolean }[],
) {
  const state: Pair[] = pairs.map((p) => ({ ...p, matched: p.matched ?? false }));
  const real = new Map<string, Row>();
  const posts: Posted[] = [];
  let gets = 0;
  const pairOfEntry = (id: string) => state.find((p) => p.entry === id);

  await page.route(/\/transactions(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    gets += 1;
    const res = await route.fetch();
    const body = await res.json();
    const list = body?.data?.transactions as Row[] | undefined;
    if (!Array.isArray(list)) return route.fulfill({ response: res, json: body });
    for (const t of list) real.set(t.id, t);
    const shift = { cleared: 0, uncleared: 0 };
    const shown: Row[] = [];
    const isImp = new Set(state.map((p) => p.imp));
    for (const t of list) {
      const pair = state.find((p) => p.imp === t.id || p.entry === t.id);
      if (!pair) {
        shown.push(t);
        continue;
      }
      const impRow = real.get(pair.imp);
      if (isImp.has(t.id)) {
        if (pair.matched) {
          shift[bucket(t)] -= t.amount;
        } else {
          shown.push(asImport(t));
        }
      } else if (pair.matched && impRow) {
        const dressed = asMatched(t, impRow);
        shift[bucket(t)] -= t.amount;
        shift[bucket(dressed)] += dressed.amount;
        shown.push(dressed);
      } else {
        shown.push(t);
      }
    }
    body.data.transactions = shown;
    const b = body.data.balances;
    if (b) {
      b.cleared += shift.cleared;
      b.uncleared += shift.uncleared;
      b.working += shift.cleared + shift.uncleared;
    }
    await route.fulfill({ response: res, json: body });
  });

  await page.route(/\/transactions\/match$/, async (route) => {
    const body = route.request().postDataJSON() as { ids: string[] };
    posts.push({ url: route.request().url(), body });
    const pair = state.find(
      (p) => body.ids.length === 2 && body.ids.includes(p.entry) && body.ids.includes(p.imp),
    );
    const entry = pair && real.get(pair.entry);
    const imp = pair && real.get(pair.imp);
    if (!pair || pair.matched || !entry || !imp) return route.continue();
    pair.matched = true;
    await route.fulfill({
      json: { data: { transaction: asMatched(entry, imp), removed: asImport(imp) } },
    });
  });

  await page.route(/\/transactions\/[^/]+\/unmatch$/, async (route) => {
    const id = route.request().url().split("/").slice(-2)[0] as string;
    posts.push({ url: route.request().url(), body: null });
    const pair = pairOfEntry(id);
    const entry = pair && real.get(pair.entry);
    const imp = pair && real.get(pair.imp);
    if (!pair || !pair.matched || !entry || !imp) return route.continue();
    pair.matched = false;
    await route.fulfill({ json: { data: { transaction: entry, imported: asImport(imp) } } });
  });

  return { posts, listGets: () => gets };
}
