import { beforeEach, describe, expect, it } from "vitest";
import { data, freshOk, type Json, n, q, rand, run, T } from "./fresh-start-helpers";
import { json } from "./helpers";
import {
  createPlan,
  type FeedPage,
  plaidTxn,
  SENTINEL,
  seedSandboxCredentials,
  stubPlaid,
  syncPages,
} from "./plaid-stub";

const feed: { pages: FeedPage[] } = { pages: [] };
let item = 0;

function stub() {
  stubPlaid({
    "/item/public_token/exchange": () => ({
      body: { access_token: SENTINEL.accessToken, item_id: `item-fs-${Date.now()}-${item++}` },
    }),
    "/accounts/get": () => ({
      body: {
        item: { institution_id: "ins_109508" },
        accounts: [
          ["acc-chk", "ZZ Checking", "depository", "checking", 1250.5],
          ["acc-cc", "ZZ Card", "credit", "credit card", 420.25],
        ].map(([account_id, name, type, subtype, current]) => ({
          account_id,
          name,
          mask: "0000",
          type,
          subtype,
          balances: { current, available: null },
        })),
      },
    }),
    "/institutions/get_by_id": () => ({
      body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
    }),
    "/transactions/sync": syncPages(() => feed.pages),
  });
}

const A = (plan: string) => `/api/v1/budgets/${plan}/accounts`;

/** A sandbox plan with both bank accounts linked through from-bank, plus a manual cash account. */
async function world() {
  const plan = await createPlan("sandbox");
  const res = await json(
    "/api/v1/bank-connections",
    { method: "POST" },
    {
      budget_id: plan,
      public_token: SENTINEL.publicToken,
      institution_id: "ins_109508",
    },
  );
  expect(res.status).toBe(201);
  const conn = (await data(res)).bank_connection as Json;
  const bank: Record<string, string> = {};
  for (const a of conn.accounts as Json[]) bank[a.name as string] = a.id;
  const fb = await json(
    `${A(plan)}/from-bank`,
    { method: "POST" },
    {
      bank_account_ids: [bank["ZZ Checking"], bank["ZZ Card"]],
      today: "2026-02-01",
    },
  );
  expect(fb.status).toBe(201);
  const created = (await data(fb)).created as Json[];
  const cash = await json(
    A(plan),
    { method: "POST" },
    { name: "ZZ Wallet", type: "cash", balance: 0, date: "2026-02-01" },
  );
  return {
    plan,
    conn: conn.id as string,
    bank,
    chk: created[0]?.account.id as string,
    card: created[1]?.account.id as string,
    wallet: (await data(cash)).account.id as string,
  };
}

const accountRows = (plan: string) =>
  q(
    "select id, name, bank_account_id, import_start_date, link_missing_since from accounts where budget_id = ? and deleted_at is null order by name",
    plan,
  );
const sb = (plan: string, name: string) =>
  q(
    `select t.amount, t.inflow_to_ready_to_assign as rta, t.date from transactions t join accounts a on a.id = t.account_id
     where t.budget_id = ? and a.name = ? and t.deleted_at is null`,
    plan,
    name,
  );
const sync = async (plan: string, conn: string) => {
  const res = await json(`/api/v1/bank-connections/${conn}/sync?budget_id=${plan}`, {
    method: "POST",
  });
  expect(res.status).toBe(200);
};
const imported = (plan: string) =>
  n(
    "select count(*) n from transactions where budget_id = ? and source = 'plaid' and deleted_at is null",
    plan,
  );

describe("Fresh Start: bank links (EXF-478)", () => {
  beforeEach(async () => {
    feed.pages = [];
    await seedSandboxCredentials();
    stub();
  });

  it("1: ticked (the default): the link moves to the new plan, imports stop in the archive", async () => {
    const w = await world();
    const { new_budget_id: nb } = await freshOk(w.plan, `ZZ-TEST new ${rand()}`);
    const fresh = await accountRows(nb);
    expect(fresh.map((a) => [a.name, a.bank_account_id, a.import_start_date])).toEqual([
      ["ZZ Card", w.bank["ZZ Card"], T],
      ["ZZ Checking", w.bank["ZZ Checking"], T],
      ["ZZ Wallet", null, null],
    ]);
    expect(await sb(nb, "ZZ Checking")).toEqual([{ amount: 1_250_500, rta: 1, date: T }]);
    expect(await sb(nb, "ZZ Card")).toEqual([{ amount: -420_250, rta: 0, date: T }]);
    expect(await sb(nb, "ZZ Wallet")).toEqual([{ amount: 0, rta: 1, date: T }]);
    const old = await accountRows(w.plan);
    for (const a of old)
      expect([a.name, a.bank_account_id, a.import_start_date, a.link_missing_since]).toEqual([
        a.name,
        null,
        null,
        null,
      ]);
    const unlinks = await q(
      "select entity_id from change_log where budget_id = ? and entity_type = 'account' and action = 'update'",
      w.plan,
    );
    expect(unlinks.map((r) => r.entity_id).sort()).toEqual([w.chk, w.card].sort());
    // the same new transaction imports into the new plan only
    feed.pages = [{ added: [plaidTxn({ transaction_id: `ZZ-N-${rand()}`, date: T, amount: 5 })] }];
    await sync(nb, w.conn);
    await sync(w.plan, w.conn);
    expect(await imported(nb)).toBe(1);
    expect(await imported(w.plan)).toBe(0);
    const conn = (await data(await json(`/api/v1/bank-connections/${w.conn}?budget_id=${nb}`)))
      .bank_connection as Json;
    expect(conn.accounts.filter((a: Json) => a.linked_account_id).length).toBe(2);
    expect(conn.accounts.every((a: Json) => fresh.some((f) => f.id === a.linked_account_id))).toBe(
      true,
    );
    // the new plan is a sandbox plan
    expect(
      (await q("select bank_environment from budgets where id = ?", nb))[0]?.bank_environment,
    ).toBe("sandbox");
  });

  it("2: unticked: both plans keep the link and both import", async () => {
    const w = await world();
    const { new_budget_id: nb } = await freshOk(w.plan, `ZZ-TEST new ${rand()}`, {
      stop_importing_in_archive: false,
    });
    expect((await accountRows(w.plan)).filter((a) => a.bank_account_id).length).toBe(2);
    expect((await accountRows(nb)).filter((a) => a.bank_account_id).length).toBe(2);
    expect(
      await n(
        "select count(*) n from change_log where budget_id = ? and entity_type = 'account' and action = 'update'",
        w.plan,
      ),
    ).toBe(0);
    feed.pages = [{ added: [plaidTxn({ transaction_id: `ZZ-N-${rand()}`, date: T, amount: 5 })] }];
    await sync(nb, w.conn);
    await sync(w.plan, w.conn);
    expect(await imported(nb)).toBe(1);
    expect(await imported(w.plan)).toBe(1);
  });

  it("3: a link whose bank account row is gone is unlinked in the new plan, with $0", async () => {
    const w = await world();
    await run("pragma foreign_keys = off");
    await run("update accounts set bank_account_id = 'ZZ-gone' where id = ?", w.chk);
    const { new_budget_id: nb } = await freshOk(w.plan, `ZZ-TEST new ${rand()}`);
    const chk = (await accountRows(nb)).find((a) => a.name === "ZZ Checking");
    expect([chk?.bank_account_id, chk?.import_start_date]).toEqual([null, null]);
    expect(await sb(nb, "ZZ Checking")).toEqual([{ amount: 0, rta: 1, date: T }]);
    expect((await accountRows(nb)).find((a) => a.name === "ZZ Card")?.bank_account_id).toBe(
      w.bank["ZZ Card"],
    );
    await run("pragma foreign_keys = on");
  });

  it("4: link_missing_since moves as is; ticked clears it in the archive", async () => {
    const w = await world();
    await run("update accounts set link_missing_since = '2026-03-01' where id = ?", w.chk);
    const { new_budget_id: nb } = await freshOk(w.plan, `ZZ-TEST new ${rand()}`);
    expect((await accountRows(nb)).find((a) => a.name === "ZZ Checking")?.link_missing_since).toBe(
      "2026-03-01",
    );
    expect(
      (await accountRows(w.plan)).find((a) => a.name === "ZZ Checking")?.link_missing_since,
    ).toBeNull();
    const w2 = await world();
    await run("update accounts set link_missing_since = '2026-03-01' where id = ?", w2.chk);
    const r = await freshOk(w2.plan, `ZZ-TEST new ${rand()}`, { stop_importing_in_archive: false });
    expect(
      (await accountRows(w2.plan)).find((a) => a.name === "ZZ Checking")?.link_missing_since,
    ).toBe("2026-03-01");
    expect(
      (await accountRows(r.new_budget_id)).find((a) => a.name === "ZZ Checking")
        ?.link_missing_since,
    ).toBe("2026-03-01");
  });
});
