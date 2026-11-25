import { transferPayeeName } from "@budget/schema/transfers";
import { type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../db/client";
import { changeSetUndos } from "../db/schema/change-set-undos";
import { logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";
import { recomputeDefaultsStmt } from "./payee-category";

/**
 * The statements of one undo (docs/undo-design.md, "Undo engine and store"). Every statement reads the change set
 * straight from `change_log`, so neither their number nor their bound parameters grow with the set's rows.
 * UNEXECUTED statements only. No IN-list sites: `in (select …)` over a derived table, never a bound list.
 */

export const UNDO_TYPES = [
  "category_group",
  "category",
  "payee",
  "payee_rename_rule",
  "account",
  "target",
  "month_category",
  "scheduled_transaction",
  "transaction",
] as const;
export type UndoType = (typeof UNDO_TYPES)[number];

/** `key`: the JSON key (`pres`: the key whose presence says the value is there); `col`: the column. */
export interface Key {
  key: string;
  col: string;
  path?: string;
  pres?: string;
  /** compared by the guard, never written */
  guardOnly?: boolean;
}
const K = (key: string, col = key): Key => ({ key, col });

const TX_KEYS = [
  "account_id",
  "date",
  "payee_id",
  "category_id",
  "inflow_to_ready_to_assign",
  "memo",
  "amount",
  "cleared",
  "approved",
  "import_id",
  "source",
  "imported_payee",
  "import_payee_name",
  "bank_description",
  "flag_color",
  "transfer_account_id",
  "transfer_transaction_id",
].map((k) => K(k));
const LINE_KEYS = ["amount", "payee_id", "category_id", "inflow_to_ready_to_assign", "memo"].map(
  (k) => K(k),
);
const TARGET_KEYS: Key[] = [
  ...[
    "cadence",
    "behavior",
    "amount",
    "day_of_week",
    "day_of_month",
    "due_date",
    "due_month",
    "created_on",
  ].map((k) => K(k)),
  { key: "repeat_every", col: "repeat_every", pres: "repeat", path: "repeat.every" },
  { key: "repeat_unit", col: "repeat_unit", pres: "repeat", path: "repeat.unit" },
];

/** The key → column table of the rule table: the single source the guards and the writes are built from. */
export const TYPE_MAPS: Record<UndoType, { table: string; keys: Key[] }> = {
  transaction: { table: "transactions", keys: TX_KEYS },
  payee: {
    table: "payees",
    keys: [
      "name",
      "hidden",
      "category_mode",
      "fixed_category_id",
      "fixed_inflow_to_ready_to_assign",
    ].map((k) => K(k)),
  },
  payee_rename_rule: {
    table: "payee_rename_rules",
    keys: ["payee_id", "kind", "text"].map((k) => K(k)),
  },
  scheduled_transaction: {
    table: "scheduled_transactions",
    keys: [
      ...[
        "account_id",
        "date_first",
        "date_next",
        "frequency",
        "amount",
        "payee_id",
        "category_id",
        "inflow_to_ready_to_assign",
        "memo",
        "flag_color",
      ].map((k) => K(k)),
      { ...K("updated_at"), guardOnly: true },
    ],
  },
  category: {
    table: "categories",
    keys: [K("group_id"), K("name"), K("sort", "sort_order"), K("hidden"), K("note")],
  },
  category_group: {
    table: "category_groups",
    keys: [K("name"), K("sort", "sort_order"), K("hidden"), K("collapsed")],
  },
  month_category: { table: "month_categories", keys: [K("assigned")] },
  target: { table: "targets", keys: TARGET_KEYS },
  account: {
    table: "accounts",
    keys: [K("starred"), K("paired_category_id"), K("sort", "sort_order")],
  },
};

/** Keys a target row may carry that the map does not write: identity and derived ones. */
export const TARGET_IGNORED = ["budget_id", "category_id", "created_month", "undo_of"];

export interface Ctx {
  db: Db;
  budgetId: string;
  /** the set being undone */
  setId: string;
  actor: string;
  now: string;
  /** the id of the undo's own move, for month cells reversed from a move or cover */
  moveId: string;
  /** `{id, m}` per rename rule: its folded `match_text` (one JSON parameter) */
  ruleTexts: string;
}

const raw = sql.raw;
const pres = (k: Key) => k.pres ?? k.path ?? k.key;

/** "Holds K": every key present in the JSON and in the map equals the column. */
function holds(alias: string, keys: readonly Key[], j: string): SQL {
  const parts = keys.map(
    (k) =>
      `(json_type(${j}, '$.${pres(k)}') is null or ${alias}.${k.col} is json_extract(${j}, '$.${k.path ?? k.key}'))`,
  );
  return raw(parts.length ? parts.join(" and ") : "1");
}

/** `col = <the JSON's value>` for each present key; an absent key leaves the column alone (`table` qualifies it where the joined net has a column of that name, e.g. a rule's `kind`). */
function sets(keys: readonly Key[], j: string, table?: string): SQL {
  return raw(
    keys
      .filter((k) => !k.guardOnly)
      .map(
        (k) =>
          `${k.col} = case when json_type(${j}, '$.${pres(k)}') is null then ${table ? `${table}.` : ""}${k.col} else json_extract(${j}, '$.${k.path ?? k.key}') end`,
      )
      .join(", "),
  );
}

/**
 * The net row of every entity of one type in the set, as a derived table `(eid, kind, before_json, after_json)`:
 * the first row's before, the last row's after; kind create / delete / update, or noop (created then deleted).
 * With `cells` every non-noop row is an `update` (month cells are always upserted).
 */
export function netRows(c: Ctx, type: UndoType): SQL {
  const kind =
    type === "month_category"
      ? sql`case when fa = 'create' and la = 'delete' then 'noop' else 'update' end`
      : sql`case when fa = 'create' and la = 'delete' then 'noop' when fa = 'create' then 'create' when la = 'delete' then 'delete' else 'update' end`;
  return sql`(select eid, ${kind} as kind, bj as before_json, aj as after_json from (
    select eid,
      max(case when ra = 1 then action end) as fa, max(case when rd = 1 then action end) as la,
      max(case when ra = 1 then before_json end) as bj, max(case when rd = 1 then after_json end) as aj
    from (select entity_id as eid, action, before_json, after_json,
        row_number() over (partition by entity_id order by rowid) as ra,
        row_number() over (partition by entity_id order by rowid desc) as rd
      from change_log where budget_id = ${c.budgetId} and change_set_id = ${c.setId} and entity_type = ${type})
    group by eid))`;
}

const net = (c: Ctx, t: UndoType) => sql`${netRows(c, t)} n`;

// ---------------------------------------------------------------------------------------------------------------
// Stale finders: the same fragment is the pre-read (a detail for the 409) and the write-time check.

const pk = (type: UndoType) => (type === "target" ? "category_id" : "id");

/** `select '<type>' as t, n.eid as id …`: entities that no longer hold what the set wrote (at most the first). */
export function staleFinder(c: Ctx, type: UndoType): SQL {
  const { table, keys } = TYPE_MAPS[type];
  if (type === "month_category") {
    const m = `coalesce(json_extract(n.after_json, '$.month'), json_extract(n.before_json, '$.month'))`;
    const cat = `coalesce(json_extract(n.after_json, '$.category_id'), json_extract(n.before_json, '$.category_id'))`;
    return sql`select ${type} as t, n.eid as id from ${net(c, type)} where n.kind <> 'noop' and
      coalesce((select m.assigned from month_categories m where m.budget_id = ${c.budgetId} and m.month = ${raw(m)} and m.category_id = ${raw(cat)}), 0)
        is not json_extract(n.after_json, '$.assigned')`;
  }
  const row = (cond: string, j: string) =>
    sql`exists (select 1 from ${raw(table)} x where x.${raw(pk(type))} = n.eid and x.budget_id = ${c.budgetId} and ${raw(cond)} and ${holds("x", keys, j)})`;
  if (type === "target") {
    return sql`select ${type} as t, n.eid as id from ${net(c, type)} where n.kind <> 'noop' and not (case n.kind
      when 'delete' then not exists (select 1 from targets x where x.category_id = n.eid)
      else ${row("1", "n.after_json")} end)`;
  }
  const first = sql`select ${type} as t, n.eid as id from ${net(c, type)} where n.kind <> 'noop' and not (case n.kind
      when 'delete' then ${row("x.deleted_at is not null", "n.before_json")}
      else ${row("x.deleted_at is null", "n.after_json")} end)`;
  if (type !== "transaction") return first;
  // The line rule: every line the set left must hold what it wrote, every line it removed must still be gone.
  const lineHolds = holds("x", LINE_KEYS, "l.value");
  const lines = sql`select ${type} as t, n.eid as id from ${net(c, type)}, json_each(n.after_json, '$.subtransactions') l
      where n.kind = 'update' and not exists (select 1 from transactions x where x.id = json_extract(l.value, '$.id') and x.deleted_at is null and ${lineHolds})`;
  const gone = sql`select ${type} as t, n.eid as id from ${net(c, type)}, json_each(n.before_json, '$.subtransactions') l
      where n.kind = 'update' and json_extract(l.value, '$.id') not in (select json_extract(a.value, '$.id') from json_each(n.after_json, '$.subtransactions') a)
      and exists (select 1 from transactions x where x.id = json_extract(l.value, '$.id') and x.deleted_at is null)`;
  return sql`select t, id from (${first} union all ${lines} union all ${gone}) limit 1`;
}

/** The finder for the pre-read: one row `(t, id)` or none. Wrapped so each type is one statement. */
export function finderStmt(c: Ctx, type: UndoType) {
  return c.db.all<{ t: string; id: string }>(
    sql`select t, id from (${staleFinder(c, type)}) limit 1`,
  );
}

/** The reads of one undo (one read-only batch): the set's rows, the record, the plan, system entities. */
export function readSetStmts(c: Ctx) {
  return [
    c.db.all<Row>(
      sql`select entity_type, entity_id, action, actor, before_json, after_json from change_log
        where budget_id = ${c.budgetId} and change_set_id = ${c.setId} order by rowid`,
    ),
    c.db.all<{ undo_change_set_id: string }>(
      sql`select undo_change_set_id from change_set_undos where budget_id = ${c.budgetId} and change_set_id = ${c.setId}`,
    ),
    c.db.all<{ id: string }>(
      sql`select id from budgets where id = ${c.budgetId} and deleted_at is null`,
    ),
    // payment categories and groups belong to their accounts: never undone
    c.db.all<{ t: string; id: string }>(
      sql`select 'category' as t, c.id as id from categories c where c.budget_id = ${c.budgetId} and c.kind is not null
          and c.id in (select entity_id from change_log where budget_id = ${c.budgetId} and change_set_id = ${c.setId} and entity_type = 'category')
        union all
        select 'category_group', g.id from category_groups g where g.budget_id = ${c.budgetId} and g.kind is not null
          and g.id in (select entity_id from change_log where budget_id = ${c.budgetId} and change_set_id = ${c.setId} and entity_type = 'category_group')`,
    ),
    ...UNDO_TYPES.map((t) => finderStmt(c, t)),
  ];
}

export interface Row {
  entity_type: string;
  entity_id: string;
  action: "create" | "update" | "delete";
  actor: string;
  before_json: string | null;
  after_json: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Checks: a statement that fails the whole batch by inserting NULL into a NOT NULL column of change_set_undos.

const abort = (c: Ctx, column: "undo_change_set_id" | "actor", cond: SQL) =>
  insertSelect(
    c.db,
    changeSetUndos,
    {
      budgetId: c.budgetId,
      changeSetId: c.setId,
      undoChangeSetId: column === "undo_change_set_id" ? sql`null` : "-",
      actor: column === "actor" ? sql`null` : c.actor,
      createdAt: c.now,
    },
    sql`where ${cond}`,
  );

/** Fails with `undo_stale` when the type's entities no longer hold what the set wrote. */
export const staleCheckStmt = (c: Ctx, t: UndoType) =>
  abort(c, "undo_change_set_id", sql`exists (${staleFinder(c, t)})`);

const liveCat = (alias: string) =>
  `exists (select 1 from categories c join category_groups g on g.id = c.group_id and g.deleted_at is null where c.id = ${alias}.category_id and c.deleted_at is null)`;
const livePayee = (alias: string) =>
  `exists (select 1 from payees p where p.id = ${alias}.payee_id and p.deleted_at is null)`;

/** After the writes: a created entity that something live still names stays (stale); a result that would break a
 *  service rule is refused. */
export function postChecks(c: Ctx, present: ReadonlySet<UndoType>): BatchItem<"sqlite">[] {
  const out: BatchItem<"sqlite">[] = [];
  const stale = (cond: SQL) => out.push(abort(c, "undo_change_set_id", cond));
  const refused = (cond: SQL) => out.push(abort(c, "actor", cond));
  if (present.has("payee"))
    stale(sql`exists (select 1 from ${net(c, "payee")} where n.kind = 'create' and (
      exists (select 1 from transactions t where t.payee_id = n.eid and t.deleted_at is null)
      or exists (select 1 from scheduled_transactions s where s.payee_id = n.eid and s.deleted_at is null)
      or exists (select 1 from payee_rename_rules r where r.payee_id = n.eid and r.deleted_at is null)))`);
  if (present.has("category"))
    stale(sql`exists (select 1 from ${net(c, "category")} where n.kind = 'create' and (
      exists (select 1 from transactions t where t.category_id = n.eid and t.deleted_at is null)
      or exists (select 1 from scheduled_transactions s where s.category_id = n.eid and s.deleted_at is null)
      or exists (select 1 from targets g where g.category_id = n.eid)
      or exists (select 1 from month_categories m where m.category_id = n.eid and m.assigned <> 0)))`);
  if (present.has("category_group"))
    stale(sql`exists (select 1 from ${net(c, "category_group")} where n.kind = 'create'
      and exists (select 1 from categories k where k.group_id = n.eid and k.deleted_at is null))`);
  if (present.has("transaction"))
    refused(sql`exists (select 1 from ${net(c, "transaction")} join transactions t on t.id = n.eid
      where n.kind in ('update', 'delete') and t.deleted_at is null and (
        not exists (select 1 from accounts a where a.id = t.account_id and a.deleted_at is null and a.closed = 0)
        or (t.category_id is not null and not ${raw(liveCat("t"))})
        or (t.payee_id is not null and not ${raw(livePayee("t"))})))`);
  if (present.has("scheduled_transaction"))
    refused(sql`exists (select 1 from ${net(c, "scheduled_transaction")} join scheduled_transactions t on t.id = n.eid
      where n.kind in ('update', 'delete') and t.deleted_at is null and (
        not exists (select 1 from accounts a where a.id = t.account_id and a.deleted_at is null)
        or (t.category_id is not null and not ${raw(liveCat("t"))})
        or (t.payee_id is not null and not ${raw(livePayee("t"))})))`);
  if (present.has("category"))
    refused(sql`exists (select 1 from ${net(c, "category")} join categories k on k.id = n.eid
      where n.kind in ('update', 'delete') and k.deleted_at is null
        and not exists (select 1 from category_groups g where g.id = k.group_id and g.deleted_at is null))`);
  if (present.has("target"))
    refused(sql`exists (select 1 from ${net(c, "target")} join targets t on t.category_id = n.eid
      where n.kind in ('update', 'delete') and not exists (select 1 from categories k where k.id = t.category_id and k.deleted_at is null))`);
  if (present.has("account"))
    refused(
      sql`exists (select 1 from ${net(c, "account")} join accounts a on a.id = n.eid where a.closed = 1 and a.starred = 1 and json_type(n.after_json, '$.starred') is not null)`,
    );
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The undo's own change_log rows.

const S = (c: Ctx) => c.setId;

/** Up to three statements per type (one per net kind), through `logSelectStmt`, so they are stamped with the undo's set. */
export function undoLogStmts(c: Ctx, type: UndoType): BatchItem<"sqlite">[] {
  const base = (action: "create" | "update" | "delete") => ({
    budgetId: c.budgetId,
    actor: c.actor,
    action,
    entityType: type,
    createdAt: c.now,
  });
  const inner = (kind: string) =>
    sql`select n.eid as eid, n.before_json as bj, n.after_json as aj from ${net(c, type)} where n.kind = ${kind}`;
  const out: BatchItem<"sqlite">[] = [];
  // the inverse of an update
  let after = sql`json_set(bj, '$.undo_of', ${S(c)})`;
  if (type === "month_category") {
    // a move or cover is reversed with its sides swapped, as a move of kind "undo"
    after = sql`case when json_type(aj, '$.move') is not null then json_set(bj, '$.undo_of', ${S(c)}, '$.move', json_object(
        'id', ${c.moveId}, 'month', json_extract(aj, '$.move.month'),
        'from_category_id', json_extract(aj, '$.move.to_category_id'), 'to_category_id', json_extract(aj, '$.move.from_category_id'),
        'amount', json_extract(aj, '$.move.amount'), 'kind', 'undo', 'undo_of', json_extract(aj, '$.move.id')))
      else json_set(bj, '$.undo_of', ${S(c)}) end`;
  }
  out.push(
    logSelectStmt(c.db, base("update"), inner("update"), {
      entityId: sql`eid`,
      before: sql`aj`,
      after,
    }),
  );
  if (type === "month_category") return out;
  // the inverse of a create: a delete
  out.push(
    logSelectStmt(c.db, base("delete"), inner("create"), {
      entityId: sql`eid`,
      before: sql`aj`,
      after: sql`json_object('undo_of', ${S(c)})`,
    }),
  );
  // the inverse of a delete: a create; a transaction that had an import tombstone carries its reason
  const restored =
    type === "transaction"
      ? sql`case when exists (select 1 from import_tombstones t where t.account_id = json_extract(bj, '$.account_id')
            and t.import_id = json_extract(bj, '$.import_id') and t.transaction_id = eid)
          then json_set(bj, '$.undo_of', ${S(c)}, '$.tombstone', json_object('reason', (select t.reason from import_tombstones t
            where t.account_id = json_extract(bj, '$.account_id') and t.import_id = json_extract(bj, '$.import_id') and t.transaction_id = eid)))
          else json_set(bj, '$.undo_of', ${S(c)}) end`
      : sql`json_set(bj, '$.undo_of', ${S(c)})`;
  out.push(
    logSelectStmt(c.db, base("create"), inner("delete"), {
      entityId: sql`eid`,
      before: null,
      after: restored,
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Restores and soft-deletes.

const TOKEN = sql`, write_token = lower(hex(randomblob(16)))`;

/** Restores of one type (net update and net delete), parents first order is the caller's. */
export function restoreStmts(c: Ctx, type: UndoType): BatchItem<"sqlite">[] {
  const { table, keys } = TYPE_MAPS[type];
  const t = raw(table);
  const token = type === "scheduled_transaction" ? TOKEN : sql``;
  const run = (q: SQL) => c.db.run(q);
  switch (type) {
    case "month_category": {
      const j = (p: string) =>
        `coalesce(json_extract(n.after_json, '$.${p}'), json_extract(n.before_json, '$.${p}'))`;
      return [
        run(sql`insert into month_categories (budget_id, month, category_id, assigned, updated_at)
          select ${c.budgetId}, ${raw(j("month"))}, ${raw(j("category_id"))}, json_extract(n.before_json, '$.assigned'), ${c.now}
          from ${net(c, type)} where n.kind = 'update'
          on conflict (budget_id, month, category_id) do update set assigned = excluded.assigned, updated_at = excluded.updated_at`),
      ];
    }
    case "account":
      return [
        run(
          sql`update accounts set ${sets(keys, "n.before_json")} from ${net(c, type)} where accounts.id = n.eid and n.kind = 'update'`,
        ),
      ];
    case "target":
      return [
        run(
          sql`update targets set ${sets(keys, "n.before_json")}, updated_at = ${c.now} from ${net(c, type)} where targets.category_id = n.eid and n.kind = 'update'`,
        ),
        run(sql`insert into targets (category_id, budget_id, cadence, behavior, amount, day_of_week, day_of_month, due_date, due_month, repeat_every, repeat_unit, created_on, created_at, updated_at)
          select n.eid, ${c.budgetId}, json_extract(n.before_json, '$.cadence'), json_extract(n.before_json, '$.behavior'), json_extract(n.before_json, '$.amount'),
            json_extract(n.before_json, '$.day_of_week'), json_extract(n.before_json, '$.day_of_month'), json_extract(n.before_json, '$.due_date'), json_extract(n.before_json, '$.due_month'),
            json_extract(n.before_json, '$.repeat.every'), json_extract(n.before_json, '$.repeat.unit'), json_extract(n.before_json, '$.created_on'), ${c.now}, ${c.now}
          from ${net(c, type)} where n.kind = 'delete'`),
      ];
    case "payee_rename_rule":
      return [
        run(sql`update payee_rename_rules set ${sets(keys, "n.before_json", "payee_rename_rules")}, deleted_at = null, updated_at = ${c.now},
            match_text = coalesce((select json_extract(m.value, '$.m') from json_each(${c.ruleTexts}) m where json_extract(m.value, '$.id') = n.eid), match_text)
          from ${net(c, type)} where payee_rename_rules.id = n.eid and n.kind in ('update', 'delete')`),
      ];
    case "transaction":
      return transactionRestores(c);
    default:
      return [
        run(sql`update ${t} set ${sets(keys, "n.before_json")}, deleted_at = null, updated_at = ${c.now}${token}
          from ${net(c, type)} where ${t}.id = n.eid and n.kind in ('update', 'delete')`),
      ];
  }
}

function transactionRestores(c: Ctx): BatchItem<"sqlite">[] {
  const type = "transaction" as const;
  const run = (q: SQL) => c.db.run(q);
  const lineSets = (j: string) => sets(LINE_KEYS, j);
  const PREFIX = transferPayeeName("");
  return [
    // rows
    run(sql`update transactions set ${sets(TX_KEYS, "n.before_json")}, deleted_at = null, updated_at = ${c.now}
      from ${net(c, type)} where transactions.id = n.eid and n.kind in ('update', 'delete')`),
    // lines the set removed (or the deleted row's) come back, the others get their keys; split_index is the position
    run(sql`update transactions set ${lineSets("jl.lv")}, deleted_at = null, updated_at = ${c.now}, split_index = jl.lk
      from (select l.key as lk, l.value as lv from ${net(c, type)}, json_each(n.before_json, '$.subtransactions') l
        where n.kind in ('update', 'delete')) jl
      where transactions.id = json_extract(jl.lv, '$.id')`),
    // lines the set added are removed
    run(sql`update transactions set deleted_at = ${c.now}, updated_at = ${c.now}
      where deleted_at is null and id in (select json_extract(l.value, '$.id') from ${net(c, type)}, json_each(n.after_json, '$.subtransactions') l where n.kind = 'update')
      and id not in (select json_extract(b.value, '$.id') from ${net(c, type)}, json_each(n.before_json, '$.subtransactions') b where n.kind = 'update')`),
    // the payee name is derived: write it where the payee or the transfer changed
    run(sql`update transactions set payee_name = case
        when transfer_account_id is not null then ${PREFIX} || coalesce((select a.name from accounts a where a.id = transactions.transfer_account_id), '')
        when payee_id is not null then (select p.name from payees p where p.id = transactions.payee_id)
        else null end
      where id in (select n.eid from ${net(c, type)} where n.kind = 'update' and json_type(n.before_json, '$.payee_id') is not null
          and (json_extract(n.before_json, '$.payee_id') is not json_extract(n.after_json, '$.payee_id')
            or json_extract(n.before_json, '$.transfer_account_id') is not json_extract(n.after_json, '$.transfer_account_id')))
        or id in (select json_extract(l.value, '$.id') from ${net(c, type)}, json_each(n.before_json, '$.subtransactions') l where n.kind = 'update')`),
    // live lines follow their parent's account, date, cleared and approved
    run(sql`update transactions set account_id = p.account_id, date = p.date, cleared = p.cleared, approved = p.approved
      from transactions p
      where transactions.parent_transaction_id = p.id and transactions.deleted_at is null
        and p.id in (select n.eid from ${net(c, type)} where n.kind in ('update', 'delete'))`),
    // an undone reject or delete of an imported row drops its tombstone
    run(sql`delete from import_tombstones where budget_id = ${c.budgetId}
      and transaction_id in (select n.eid from ${net(c, type)} where n.kind = 'delete')`),
  ];
}

/** Soft-deletes of the entities the set created (net create); children first is the caller's order. */
export function softDeleteStmts(c: Ctx, type: UndoType): BatchItem<"sqlite">[] {
  const { table } = TYPE_MAPS[type];
  const t = raw(table);
  const run = (q: SQL) => c.db.run(q);
  switch (type) {
    case "month_category":
    case "account":
      return [];
    case "target":
      return [
        run(sql`delete from targets where budget_id = ${c.budgetId}
          and category_id in (select n.eid from ${net(c, type)} where n.kind = 'create')`),
      ];
    case "transaction":
      return [
        run(sql`update transactions set deleted_at = ${c.now}, updated_at = ${c.now}
          where deleted_at is null and (id in (select n.eid from ${net(c, type)} where n.kind = 'create')
            or parent_transaction_id in (select n.eid from ${net(c, type)} where n.kind = 'create'))`),
        // an undo row that carries a tombstone (the redo of a reject) puts it back
        run(sql`insert into import_tombstones (account_id, import_id, budget_id, reason, transaction_id, created_at)
          select json_extract(n.after_json, '$.account_id'), json_extract(n.after_json, '$.import_id'), ${c.budgetId},
            json_extract(n.after_json, '$.tombstone.reason'), n.eid, ${c.now}
          from ${net(c, type)} where n.kind = 'create' and json_extract(n.after_json, '$.tombstone.reason') is not null
          on conflict (account_id, import_id) do nothing`),
      ];
    default:
      return [
        run(sql`update ${t} set deleted_at = ${c.now}, updated_at = ${c.now}${type === "scheduled_transaction" ? TOKEN : sql``}
          from ${net(c, type)} where ${t}.id = n.eid and n.kind = 'create'`),
      ];
  }
}

/** The recompute of the stored payee defaults of the payees involved (null when none is named). */
export const recomputeStmt = (c: Ctx, payeeIds: readonly string[]) =>
  recomputeDefaultsStmt(c.db, c.budgetId, payeeIds);

/** The record: its primary key makes a racing second undo fail with `UNIQUE constraint failed: change_set_undos`. */
export function recordStmt(c: Ctx, undoSetId: string) {
  return insertSelect(c.db, changeSetUndos, {
    budgetId: c.budgetId,
    changeSetId: c.setId,
    undoChangeSetId: undoSetId,
    actor: c.actor,
    createdAt: c.now,
  });
}

/** Restores in the order of the rule table: parents first. */
export const RESTORE_ORDER: readonly UndoType[] = UNDO_TYPES;
/** Soft-deletes of created entities: children first. */
export const REMOVE_ORDER: readonly UndoType[] = [...UNDO_TYPES].reverse();
