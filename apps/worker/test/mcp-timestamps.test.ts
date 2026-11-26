import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { A, account, DAY, data, send, tool } from "./account-helpers";
import { json } from "./helpers";
import { createPlan, stubPlaid } from "./plaid-stub";
import { sampleFiles } from "./plan-import-helpers";
import { listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed tool results
type Json = any;

const MONTH = "2026-11-01";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

type Ctx = {
  payee: string;
  payeeDel: string;
  payeeCombA: string;
  payeeCombB: string;
  payeeBulkA: string;
  payeeBulkB: string;
  payeeRepl: string;
  bid: string;
  spare: string;
  other: string;
  checking: string;
  tracking: string;
  group: string;
  category: string;
  category2: string;
  tx: string;
  spareTx: string;
  bulkTx: string;
  importTx: string;
  pendingTx: string;
  matchEntry: string;
  matchImport: string;
  conn: string;
  bankAccount: string;
  bankAccount2: string;
  secondPlan: string;
  sched: string;
  sched2: string;
};
let ctx: Ctx;

async function seed(): Promise<Ctx> {
  const bid = await createPlan("sandbox");
  const opened = await send(`/api/v1/budgets/${bid}`, "PATCH", { opened: true });
  expect(opened.status).toBe(200);
  const checking = (await account(bid, "checking", 100000)).id as string;
  const tracking = (await account(bid, "otherAsset", 50000)).id as string;
  const spare = (await account(bid, "checking", 0)).id as string;
  const other = (await account(bid, "savings", 0)).id as string;
  const m = await data(await json(`/api/v1/budgets/${bid}/months/${MONTH}`));
  const group = m.groups[0].id as string;
  const cats = m.groups.flatMap((g: Json) => g.categories) as Json[];
  const category = cats[0].id as string;
  const category2 = cats[1].id as string;
  const T = `/api/v1/budgets/${bid}/transactions`;
  const mk = async (body: Json) =>
    (await data(await send(T, "POST", body))).transaction.id as string;
  const txId = await mk({
    account_id: checking,
    date: DAY,
    amount: -5000,
    payee_name: "ZZ P",
    category_id: category,
  });
  await mk({
    account_id: checking,
    date: DAY,
    amount: -3000,
    payee_name: "ZZ S",
    subtransactions: [
      { amount: -1000, category_id: category },
      { amount: -1000, category_id: category },
      { amount: -1000, category_id: category2 },
    ],
  });
  await mk({ account_id: checking, date: DAY, amount: -1000, transfer_account_id: other });
  const spareTx = await mk({
    account_id: checking,
    date: DAY,
    amount: -100,
    payee_name: "ZZ T",
    category_id: category,
  });
  // A throwaway row for delete_transactions, and the rows the bulk tools change.
  const bulkTx = await mk({
    account_id: checking,
    date: DAY,
    amount: -300,
    payee_name: "ZZ B",
    category_id: category,
  });
  // A throwaway unapproved import, for reject_transactions.
  const importTx = await mk({
    account_id: checking,
    date: DAY,
    amount: -200,
    payee_name: "ZZ I",
    category_id: category,
  });
  await env.DB.prepare(
    "update transactions set import_id = 'zz-imp-1', source = 'plaid', approved = 0 where id = ?",
  )
    .bind(importTx)
    .run();
  // A pending bank transaction, for enter_pending_transaction (EXF-466).
  const pendingTx = crypto.randomUUID();
  await env.DB.prepare(
    "insert into pending_transactions (id, budget_id, account_id, plaid_transaction_id, date, amount, payee_name, created_at, updated_at) values (?, ?, ?, ?, ?, -300, 'ZZ Pending', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
  )
    .bind(pendingTx, bid, checking, `zz-pend-${pendingTx}`, DAY)
    .run();
  // A hand entry and an unapproved import of the same account, for match_transactions and unmatch_transaction.
  const matchEntry = await mk({
    account_id: checking,
    date: DAY,
    amount: -250,
    payee_name: "ZZ M",
  });
  const matchImport = await mk({
    account_id: checking,
    date: DAY,
    amount: -260,
    payee_name: "ZZ MI",
  });
  await env.DB.prepare(
    "update transactions set import_id = 'zz-imp-2', source = 'plaid', approved = 0, cleared = 'cleared', imported_payee = 'ZZ MI', bank_description = 'ZZ MI', import_date = date, import_amount = amount, import_payee_name = 'ZZ MI' where id = ?",
  )
    .bind(matchImport)
    .run();
  expect(
    (await send(`${A(bid)}/${checking}/adjust-balance`, "POST", { balance: 90000 })).status,
  ).toBe(200);

  // Payees the payee tools act on (each has a transaction, so delete moves rows).
  const payeeNames = [
    "ZZ Timestamps Payee",
    "ZZ Pay Delete",
    "ZZ Pay Bulk A",
    "ZZ Pay Bulk B",
    "ZZ Pay Repl",
    "ZZ Pay Comb A",
    "ZZ Pay Comb B",
  ];
  for (const payee_name of payeeNames) {
    await mk({ account_id: checking, date: DAY, amount: -100, payee_name });
  }
  const payeeList = (await data(await send(`/api/v1/budgets/${bid}/payees`, "GET"))).payees as {
    id: string;
    name: string;
  }[];
  const [
    payee = "",
    payeeDel = "",
    payeeBulkA = "",
    payeeBulkB = "",
    payeeRepl = "",
    payeeCombA = "",
    payeeCombB = "",
  ] = payeeNames.map((n) => payeeList.find((p) => p.name === n)?.id as string);

  const now = new Date().toISOString();
  const conn = crypto.randomUUID();
  await env.DB.prepare(
    "insert into bank_connections (id, display_id, environment, plaid_item_id, institution_id, institution_name, nickname, status, provider, last_synced_at, created_at, updated_at) values (?, ?, 'sandbox', ?, 'ins_1', 'ZZ Bank', 'ZZ Bank', 'connected', 'Plaid', ?, ?, ?)",
  )
    .bind(
      conn,
      crypto
        .randomUUID()
        .slice(0, 6)
        .replace(/[^0-9a-f]/g, "a"),
      crypto.randomUUID(),
      now,
      now,
      now,
    )
    .run();
  const bankAccount = crypto.randomUUID();
  const bankAccount2 = crypto.randomUUID();
  for (const [id, name] of [
    [bankAccount, "ZZ Bank One"],
    [bankAccount2, "ZZ Bank Two"],
  ]) {
    await env.DB.prepare(
      "insert into bank_accounts (id, bank_connection_id, plaid_account_id, name, mask, type, subtype, current_balance, available_balance, balance_updated_at, created_at) values (?, ?, ?, ?, '0000', 'depository', 'checking', 1000, 1000, ?, ?)",
    )
      .bind(id, conn, crypto.randomUUID(), name, now, now)
      .run();
  }
  const secondPlan = await createPlan("sandbox");
  const mkSched = async (memo: string) =>
    (
      await data(
        await send(`/api/v1/budgets/${bid}/scheduled-transactions`, "POST", {
          account_id: checking,
          date_first: "2099-01-15",
          frequency: "monthly",
          amount: -4000,
          payee_name: "ZZ Sched",
          memo,
        }),
      )
    ).scheduled_transaction.id as string;
  const sched = await mkSched("one");
  const sched2 = await mkSched("two");
  return {
    payee,
    payeeDel,
    payeeBulkA,
    payeeBulkB,
    payeeCombA,
    payeeCombB,
    payeeRepl,
    sched,
    sched2,
    bid,
    spare,
    other,
    checking,
    tracking,
    group,
    category,
    category2,
    tx: txId,
    spareTx,
    bulkTx,
    importTx,
    pendingTx,
    matchEntry,
    matchImport,
    conn,
    bankAccount,
    bankAccount2,
    secondPlan,
  };
}

const results = new Map<string, Json>();

/** Tools in call order; the mutating and deleting ones come last, on throwaway rows. */
const CALLS: [string, (c: Ctx) => Json][] = [
  [
    "preview_transactions_file",
    (c) => ({
      budget_id: c.bid,
      account_id: c.checking,
      file_name: "sample.csv",
      content_base64: btoa(
        "Date,Payee,Memo,Outflow,Inflow\n11/10/2026,ZZ-TEST Preview Cafe,latte,4.50,\n",
      ),
      options: { today: "2026-11-24" },
    }),
  ],
  [
    "import_transactions_file",
    (c) => ({
      budget_id: c.bid,
      account_id: c.checking,
      file_name: "one.csv",
      content_base64: btoa(
        "Date,Payee,Memo,Outflow,Inflow\n11/11/2026,ZZ-TEST Import Cafe,mug,3.25,\n",
      ),
      options: { today: "2026-11-24" },
    }),
  ],
  ["list_budgets", () => ({})],
  ["get_backup_status", () => ({})],
  ["get_budget", (c) => ({ budget_id: c.bid })],
  ["export_budget", (c) => ({ budget_id: c.bid })],
  [
    "import_budget_export",
    () => {
      const f = sampleFiles();
      const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
      return {
        files: [
          {
            file_name: "Sample Plan as of 2026-11-15 19-51 - Plan.csv",
            content_base64: b64(f.plan),
          },
          {
            file_name: "Sample Plan as of 2026-11-15 19-51 - Register.csv",
            content_base64: b64(f.register),
          },
        ],
        name: "ZZ-TEST imported",
      };
    },
  ],
  ["continue_budget_import", () => ({ import_id: results.get("import_budget_export")?.import_id })],
  ["create_budget", () => ({ name: "ZZ-TEST made by tool", bank_environment: "sandbox" })],
  ["update_budget", (c) => ({ budget_id: c.bid, name: "ZZ-TEST renamed" })],
  ["set_expected_income", (c) => ({ budget_id: c.bid, expected_income: 500000 })],
  ["update_flag_names", (c) => ({ budget_id: c.bid, flag_names: { red: "ZZ Tax" } })],
  ["list_accounts", (c) => ({ budget_id: c.bid, include_closed: true })],
  ["reorder_accounts", (c) => ({ budget_id: c.bid, account_ids: [c.checking] })],
  ["get_account", (c) => ({ budget_id: c.bid, account_id: c.checking })],
  ["get_account_summary", (c) => ({ budget_id: c.bid })],
  ["list_transactions", (c) => ({ budget_id: c.bid })],
  ["list_unapproved_transactions", (c) => ({ budget_id: c.bid })],
  ["search_transactions", (c) => ({ budget_id: c.bid, query: "ZZ" })],
  ["get_account_balances", (c) => ({ budget_id: c.bid, account_id: c.checking })],
  ["get_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.tx })],
  ["list_payees", (c) => ({ budget_id: c.bid })],
  ["list_payee_transactions", (c) => ({ budget_id: c.bid, payee_id: c.payee })],
  [
    "set_payee_category_mode",
    (c) => ({ budget_id: c.bid, payee_id: c.payee, category_mode: "off" }),
  ],
  ["list_payee_recent_transactions", (c) => ({ budget_id: c.bid, payee_id: c.payee })],
  ["list_bank_connections", (c) => ({ budget_id: c.bid })],
  ["get_bank_connection", (c) => ({ budget_id: c.bid, bank_connection_id: c.conn })],
  ["get_plan_month", (c) => ({ budget_id: c.bid, month: MONTH })],
  ["get_month_summary", (c) => ({ budget_id: c.bid, month: MONTH })],
  ["list_plan_months", (c) => ({ budget_id: c.bid, from: MONTH, to: MONTH })],
  ["get_month_range", (c) => ({ budget_id: c.bid })],
  ["get_month_category", (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category })],
  [
    "list_category_transactions",
    (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category }),
  ],
  ["get_net_worth", (c) => ({ budget_id: c.bid })],
  ["get_spending_breakdown", (c) => ({ budget_id: c.bid, start_month: MONTH, end_month: MONTH })],
  ["get_spending_trends", (c) => ({ budget_id: c.bid, start_month: MONTH, end_month: MONTH })],
  ["get_income_expense", (c) => ({ budget_id: c.bid, start_month: MONTH, end_month: MONTH })],
  ["get_age_of_money", (c) => ({ budget_id: c.bid })],
  [
    "list_report_transactions",
    (c) => ({ budget_id: c.bid, start_month: MONTH, end_month: MONTH, category_id: c.category }),
  ],
  ["get_category_usage", (c) => ({ budget_id: c.bid, category_id: c.category })],
  ["get_category_group_usage", (c) => ({ budget_id: c.bid, group_id: c.group })],
  ["create_category_group", (c) => ({ budget_id: c.bid, name: "ZZ Group" })],
  ["create_category", (c) => ({ budget_id: c.bid, group_id: c.group, name: "ZZ Cat" })],
  ["rename_category", (c) => ({ budget_id: c.bid, category_id: c.category2, name: "ZZ Renamed" })],
  ["set_category_hidden", (c) => ({ budget_id: c.bid, category_id: c.category2, hidden: true })],
  ["unhide_all_categories", (c) => ({ budget_id: c.bid })],
  ["set_category_note", (c) => ({ budget_id: c.bid, category_id: c.category2, note: "ZZ note" })],
  [
    "rename_category_group",
    (c) => ({ budget_id: c.bid, group_id: c.group, name: "ZZ Group renamed" }),
  ],
  ["set_category_group_hidden", (c) => ({ budget_id: c.bid, group_id: c.group, hidden: false })],
  [
    "set_assigned",
    (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category, assigned: 1000 }),
  ],
  [
    "move_money",
    (c) => ({
      budget_id: c.bid,
      month: MONTH,
      from: "ready_to_assign",
      to: c.category,
      amount: 100,
    }),
  ],
  [
    "cover_overspending",
    (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category, from: c.category2 }),
  ],
  ["list_recent_moves", (c) => ({ budget_id: c.bid })],
  ["set_month_note", (c) => ({ budget_id: c.bid, month: MONTH, note: "ZZ month" })],
  [
    "create_transaction",
    (c) => ({
      budget_id: c.bid,
      account_id: c.checking,
      date: DAY,
      amount: -200,
      payee_name: "ZZ N",
      category_id: c.category,
    }),
  ],
  [
    "create_transfer",
    (c) => ({
      budget_id: c.bid,
      from_account_id: c.checking,
      to_account_id: c.other,
      date: DAY,
      amount: 300,
    }),
  ],
  ["update_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.tx, memo: "ZZ memo" })],
  ["approve_transactions", (c) => ({ budget_id: c.bid, ids: [c.tx] })],
  ["flag_transactions", (c) => ({ budget_id: c.bid, ids: [c.tx], color: "red" })],
  [
    "bulk_update_transactions",
    (c) => ({ budget_id: c.bid, ids: [c.tx], op: "memo", value: "ZZ bulk" }),
  ],
  [
    "create_account",
    (c) => ({ budget_id: c.bid, name: "ZZ Made", type: "checking", balance: 1000, date: DAY }),
  ],
  ["update_account", (c) => ({ budget_id: c.bid, account_id: c.tracking, note: "ZZ note" })],
  ["adjust_account_balance", (c) => ({ budget_id: c.bid, account_id: c.tracking, balance: 40000 })],
  ["create_accounts_from_bank", (c) => ({ budget_id: c.bid, bank_account_ids: [c.bankAccount] })],
  [
    "link_account",
    (c) => ({ budget_id: c.bid, account_id: c.spare, bank_account_id: c.bankAccount2 }),
  ],
  ["unlink_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  [
    "rename_bank_connection",
    (c) => ({ budget_id: c.bid, bank_connection_id: c.conn, nickname: "ZZ Nick" }),
  ],
  // The seeded connection has no token: the sync marks it broken and calls no bank.
  ["sync_bank_connections", (c) => ({ budget_id: c.bid, bank_connection_id: c.conn })],
  ["close_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  ["reopen_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  [
    "reconcile_account",
    (c) => ({
      budget_id: c.bid,
      account_id: c.other,
      statement_balance: 5000,
      create_adjustment: true,
    }),
  ],
  ["get_account_view_settings", (c) => ({ budget_id: c.bid, account_id: c.checking })],
  [
    "update_account_view_settings",
    (c) => ({ budget_id: c.bid, account_id: c.checking, show_flags: false }),
  ],
  ["get_all_accounts_view_settings", (c) => ({ budget_id: c.bid })],
  ["update_all_accounts_view_settings", (c) => ({ budget_id: c.bid, show_flags: false })],
  ["list_scheduled_transactions", (c) => ({ budget_id: c.bid })],
  ["get_scheduled_transaction", (c) => ({ budget_id: c.bid, id: c.sched })],
  [
    "create_scheduled_transaction",
    (c) => ({
      budget_id: c.bid,
      account_id: c.checking,
      date_first: "2099-02-01",
      frequency: "weekly",
      amount: -100,
      payee_name: "ZZ Sched N",
    }),
  ],
  [
    "update_scheduled_transaction",
    (c) => ({ budget_id: c.bid, id: c.sched, memo: "ZZ updated", today: "2026-11-15" }),
  ],
  [
    "list_upcoming_for_category",
    (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category }),
  ],
  [
    "bulk_update_scheduled_transactions",
    (c) => ({ budget_id: c.bid, ids: [c.sched], op: "flag", value: "red" }),
  ],
  ["enter_due_scheduled_transactions", (c) => ({ budget_id: c.bid, today: "2026-11-15" })],
  [
    "enter_scheduled_transaction_now",
    (c) => ({ budget_id: c.bid, id: c.sched2, today: "2026-11-15" }),
  ],
  ["delete_scheduled_transaction", (c) => ({ budget_id: c.bid, id: c.sched })],
  ["delete_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.spareTx })],
  ["match_transactions", (c) => ({ budget_id: c.bid, ids: [c.matchEntry, c.matchImport] })],
  ["unmatch_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.matchEntry })],
  ["reject_transactions", (c) => ({ budget_id: c.bid, ids: [c.importTx] })],
  ["enter_pending_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.pendingTx })],
  ["delete_transactions", (c) => ({ budget_id: c.bid, ids: [c.bulkTx] })],
  [
    "rename_payee",
    (c) => ({
      budget_id: c.bid,
      payee_id: c.payee,
      name: `ZZ Renamed ${crypto.randomUUID().slice(0, 8)}`,
    }),
  ],
  ["set_payee_hidden", (c) => ({ budget_id: c.bid, payee_id: c.payee, hidden: true })],
  [
    "delete_payee",
    (c) => ({ budget_id: c.bid, payee_id: c.payeeDel, replacement_payee_id: c.payeeRepl }),
  ],
  [
    "bulk_update_payees",
    (c) => ({ budget_id: c.bid, payee_ids: [c.payeeBulkA, c.payeeBulkB], action: "hide" }),
  ],
  [
    "combine_payees",
    (c) => ({
      budget_id: c.bid,
      payee_ids: [c.payeeCombA, c.payeeCombB],
      name: "ZZ Pay Combined",
      target_payee_id: c.payeeCombA,
    }),
  ],
  [
    "create_payee_rename_rule",
    (c) => ({ budget_id: c.bid, payee_id: c.payee, kind: "contains", text: "zz rename rule" }),
  ],
  ["list_payee_rename_rules", (c) => ({ budget_id: c.bid, payee_id: c.payee })],
  [
    "update_payee_rename_rule",
    (c) => ({
      budget_id: c.bid,
      payee_id: c.payee,
      rule_id: ((results.get("create_payee_rename_rule") as Json).rule as Json).id,
      kind: "is",
    }),
  ],
  [
    "delete_payee_rename_rule",
    (c) => ({
      budget_id: c.bid,
      payee_id: c.payee,
      rule_id: ((results.get("create_payee_rename_rule") as Json).rule as Json).id,
    }),
  ],
  ["create_view", (c) => ({ budget_id: c.bid, name: "ZZ View", category_ids: [c.category] })],
  ["list_views", (c) => ({ budget_id: c.bid })],
  [
    "update_view",
    (c) => ({
      budget_id: c.bid,
      view_id: ((results.get("create_view") as Json).view as Json).id,
      name: "ZZ View two",
    }),
  ],
  [
    "reorder_views",
    (c) => ({
      budget_id: c.bid,
      ids: [
        ((results.get("create_view") as Json).view as Json).id,
        "snoozed",
        "money_available",
        "overfunded",
        "underfunded",
      ],
    }),
  ],
  [
    "delete_view",
    (c) => ({
      budget_id: c.bid,
      view_id: ((results.get("create_view") as Json).view as Json).id,
    }),
  ],
  [
    "set_category_target",
    (c) => ({
      budget_id: c.bid,
      category_id: c.category,
      cadence: "monthly",
      behavior: "set_aside",
      amount: 100000,
    }),
  ],
  [
    "snooze_target",
    (c) => ({
      budget_id: c.bid,
      month: MONTH,
      category_id: c.category,
      snoozed: true,
      today: "2026-11-15",
    }),
  ],
  [
    "preview_auto_assign",
    (c) => ({ budget_id: c.bid, month: MONTH, category_ids: [c.category], today: "2026-11-15" }),
  ],
  [
    "auto_assign",
    (c) => ({
      budget_id: c.bid,
      month: MONTH,
      strategy: "underfunded",
      category_ids: [c.category],
      today: "2026-11-15",
    }),
  ],
  ["delete_category_target", (c) => ({ budget_id: c.bid, category_id: c.category })],
  [
    "delete_category",
    (c) => ({ budget_id: c.bid, category_id: c.category2, reassign_to: c.category }),
  ],
  [
    "delete_category_group",
    (c) => ({
      budget_id: c.bid,
      group_id: (Object.values(results.get("create_category_group") ?? {})[0] as Json).id,
    }),
  ],
  ["delete_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  ["remove_bank_connection", (c) => ({ budget_id: c.bid, bank_connection_id: c.conn })],
  ["delete_budget", (c) => ({ budget_id: c.secondPlan })],
];

/** A tool this test cannot call, with the reason. */
const NOT_CALLED: Record<string, string> = {
  fresh_start_budget: "returns ids only; no timestamp",
  pay_credit_card: "the seed has no credit card",
  record_loan_payment:
    "the seed has no loan account; covered by loan-activity.test.ts (the pair's timestamps are the transactions')",
  get_loan_activity:
    "the seed has no loan account; covered by loan-activity.test.ts; no timestamps",
  get_loan_summary:
    "the seed has no loan account; covered by loan-summary.test.ts; balance_updated_at is the account's last_reconciled_at",
  pair_loan_category:
    "the seed has no loan account; covered by loan-pairing.test.ts; returns the account as update_account does",
  add_loan_activity: "the seed has no loan account; covered by loan-add-activity.test.ts",
  update_loan_activity: "the seed has no loan account; covered by loan-manage-activity.test.ts",
  delete_loan_activity: "the seed has no loan account; covered by loan-manage-activity.test.ts",
  simulate_loan_payoff: "the seed has no loan account; covered by loan-payoff-simulation.test.ts",
  update_loan_balance:
    "the seed has no loan account; covered by loan-balance-update.test.ts; balance_updated_at is the account's last_reconciled_at",
  cancel_budget_import: "needs an unfinished import; covered by plan-import-steps.test.ts",
  set_card_payment_target:
    "needs a credit card payment category; covered by card-targets.test.ts; its result has no timestamp",
  set_debt_payment_target:
    "needs a loan-paired category; covered by debt-targets.test.ts; its result has no timestamp",
  move_category: "its result has no timestamp; covered by category-move.test.ts",
  move_category_group: "its result has no timestamp; covered by category-move.test.ts",
  get_card_payment_status: "returns amounts only, no timestamp; the fixture has no credit account",
};

/** A tool of a file another Build holds, whose result holds a timestamp the description may not name yet. */
const HELD: Record<string, string> = {};

const collect = (v: Json, out: Map<string, string | null>) => {
  if (Array.isArray(v)) for (const x of v) collect(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && ISO.test(x) && !Number.isNaN(Date.parse(x))) out.set(k, x);
      else if (x === null && !out.has(k)) out.set(k, null);
      else collect(x, out);
    }
  }
};

describe("tool descriptions state the timestamp formats (EXF-587)", () => {
  let descriptions: Record<string, string>;
  beforeAll(async () => {
    ctx = await seed();
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const list = await mcpRpc("tools/list", {}, 2);
    descriptions = Object.fromEntries(
      ((list.body.result as Json).tools as Json[]).map((t) => [t.name, t.description as string]),
    );
    stubPlaid({ "/item/remove": () => ({ body: { removed: true } }) });
    for (const [name, args] of CALLS) {
      const res = await tool(name, args(ctx));
      if (res.isError) throw new Error(`${name}: ${res.content?.[0]?.text}`);
      results.set(name, JSON.parse(res.content[0].text));
    }
  });

  it("every listed tool is called or has a reason", async () => {
    const called = new Set(CALLS.map(([n]) => n));
    for (const n of await listedToolNames()) {
      expect(
        called.has(n) !== n in NOT_CALLED,
        `${n}: in exactly one of CALLS and NOT_CALLED`,
      ).toBe(true);
    }
    for (const r of [...Object.values(NOT_CALLED), ...Object.values(HELD)]) expect(r).not.toBe("");
    expect(called.size).toBe(CALLS.length);
  });

  it("finds timestamps in the results and requires each to be named by its tool", () => {
    const all = new Set<string>();
    for (const [name, result] of results) {
      const found = new Map<string, string | null>();
      collect(result, found);
      for (const [k, v] of found) if (v !== null) all.add(k);
      if (name in HELD) continue;
      const desc = descriptions[name] ?? "";
      const named = (/Timestamps \(([^)]*)\) are ISO 8601 date-times in UTC/.exec(desc)?.[1] ?? "")
        .split(", ")
        .filter(Boolean);
      const nullable = (/Timestamps that can be null: ([^.]*)\./.exec(desc)?.[1] ?? "")
        .split(", ")
        .filter(Boolean);
      for (const [k, v] of found) {
        if (v === null && !named.includes(k) && !all.has(k)) continue;
        if (v !== null) expect(named, `${name}: name ${k} among its timestamps`).toContain(k);
      }
      for (const k of nullable) expect(named, `${name}: ${k} is a timestamp`).toContain(k);
    }
    for (const k of ["created_at", "updated_at", "last_modified_on", "last_synced_at"]) {
      expect([...all], `a timestamp key ${k} is found`).toContain(k);
    }
    // a key that is null in a result and a timestamp elsewhere is named, as nullable, where it appears
    for (const [name, result] of results) {
      if (name in HELD) continue;
      const found = new Map<string, string | null>();
      collect(result, found);
      const desc = descriptions[name] ?? "";
      const nullable = (/Timestamps that can be null: ([^.]*)\./.exec(desc)?.[1] ?? "").split(", ");
      for (const [k, v] of found) {
        if (v === null && all.has(k))
          expect(nullable, `${name}: name ${k} as nullable`).toContain(k);
      }
    }
  });

  it("no description still says Dates are YYYY-MM-DD.", () => {
    for (const [name, d] of Object.entries(descriptions)) {
      expect(d, name).not.toContain("Dates are YYYY-MM-DD.");
    }
  });

  it("reports what it called", () => {
    const missing = Object.keys(NOT_CALLED).join(", ") || "none";
    const held = Object.keys(HELD).join(", ") || "none";
    console.info(
      `mcp-timestamps: called ${CALLS.length} of ${CALLS.length + Object.keys(NOT_CALLED).length} tools; not called: ${missing}; held: ${held}`,
    );
  });
});
