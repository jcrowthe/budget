import type { UndoResult, UndoWhere } from "@budget/schema/changes";
import { UNDO_ERRORS } from "@budget/schema/changes";
import { foldRuleText } from "@budget/schema/rename-rules";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { currentChangeSetId, runInChangeSet } from "../history/change-set";
import * as undoRepo from "../repositories/undo";
import {
  type Ctx,
  REMOVE_ORDER,
  RESTORE_ORDER,
  type Row,
  TARGET_IGNORED,
  TYPE_MAPS,
  UNDO_TYPES,
  type UndoType,
} from "../repositories/undo";

export type UndoCode = "not_found" | "forbidden" | "already_undone" | "undo_refused" | "undo_stale";

/** A refusal the route turns into the error envelope. */
export class UndoRefused extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    readonly code: UndoCode,
    detail: string,
  ) {
    super(detail);
    this.name = "UndoRefused";
  }
}

const isUuid = (s: string) => z.uuid().safeParse(s).success;
// biome-ignore lint/suspicious/noExplicitAny: change_log JSON is untyped
type Json = Record<string, any>;
const parse = (s: string | null): Json | null => (s === null ? null : (JSON.parse(s) as Json));

export interface Net {
  type: string;
  id: string;
  kind: "create" | "update" | "delete" | "noop";
  before: Json | null;
  after: Json | null;
}

/** One net row per (type, entity): the first row's before, the last row's after (same rule as the SQL). */
export function netOf(rows: readonly Row[]): Net[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.entity_type}\u0000${r.entity_id}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()].map((list) => {
    const first = list[0] as Row;
    const last = list.at(-1) as Row;
    const kind =
      first.action === "create" && last.action === "delete"
        ? "noop"
        : first.action === "create"
          ? "create"
          : last.action === "delete"
            ? "delete"
            : "update";
    return {
      type: first.entity_type,
      id: first.entity_id,
      kind: first.entity_type === "month_category" && kind !== "noop" ? "update" : kind,
      before: parse(first.before_json),
      after: parse(last.after_json),
    };
  });
}

const refuse = (detail: string): never => {
  throw new UndoRefused(409, "undo_refused", detail);
};

/** The refusals that need only the rows (spec 3.3). */
function refusals(nets: readonly Net[], system: ReadonlySet<string>) {
  const known = new Set<string>(UNDO_TYPES);
  for (const n of nets) {
    if (n.kind === "noop") continue;
    if (!known.has(n.type)) refuse(`${UNDO_ERRORS.undo_refused}: ${n.type}`);
    const b = n.before;
    const a = n.after;
    if (n.type === "transaction") {
      if (a?.cleared === "reconciled" && b?.cleared !== "reconciled" && n.kind === "update")
        refuse("Reconciling can't be undone");
      if (n.kind === "update" && b && a && (b.import_id ?? null) !== (a.import_id ?? null))
        refuse("A bank match can't be undone here; unmatch it instead");
    }
    if (n.type === "account") {
      const keys = new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]);
      const other = [...keys].some(
        (k) =>
          k !== "starred" &&
          k !== "sort" &&
          k !== "paired_category_id" &&
          k !== "interest_rate" &&
          k !== "escrow_amount" &&
          k !== "last_reconciled_at" &&
          JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]),
      );
      if (n.kind !== "update" || other) refuse(`${UNDO_ERRORS.undo_refused}: account`);
    }
    if (n.type === "payee") {
      // EXF-543: a system payee a set created stays (a balance update makes its own); any other change refuses.
      if ((b?.system ?? a?.system) != null && !(n.kind === "create" && a?.system != null))
        refuse("A system payee can't be undone");
      // Sets written before the move rows were logged (EXF-882) can't return what moved; new sets can.
      if (n.kind === "delete") {
        const logged = (type: string) =>
          nets.some((m) => m.type === type && m.kind !== "noop" && m.before?.payee_id === n.id);
        if (
          ((a?.transactions_moved ?? 0) > 0 && !logged("transaction")) ||
          ((a?.scheduled_moved ?? 0) > 0 && !logged("scheduled_transaction"))
        )
          refuse("Its transactions moved to another payee and can't be moved back");
      }
    }
    if ((n.type === "category" || n.type === "category_group") && system.has(`${n.type}:${n.id}`))
      refuse("A credit card payment category can't be undone");
    if (n.type === "target") {
      const own = new Set([
        ...TYPE_MAPS.target.keys.map((k) => k.pres ?? k.key),
        "repeat",
        ...TARGET_IGNORED,
      ]);
      for (const k of [...Object.keys(b ?? {}), ...Object.keys(a ?? {})])
        if (!own.has(k)) refuse(`${UNDO_ERRORS.undo_refused}: target ${k}`);
    }
  }
}

/** D6: where the surface should navigate, from the rows alone. */
export function whereOf(nets: readonly Net[]): UndoWhere {
  const live = nets.filter((n) => n.kind !== "noop");
  const tx = live.filter((n) => n.type === "transaction");
  const acct = (n: Net) => (n.before?.account_id ?? n.after?.account_id) as string | undefined;
  const first = tx.find((n) => acct(n));
  if (first) {
    const account = acct(first) as string;
    const ids = tx
      .filter((n) => n.kind !== "create" && acct(n) === account && !n.before?.parent_transaction_id)
      .map((n) => n.id);
    return { surface: "register", account_id: account, transaction_ids: ids.slice(0, 50) };
  }
  const other = live.find((n) => n.type === "scheduled_transaction" || n.type === "account");
  if (other) {
    const id = other.type === "account" ? other.id : acct(other);
    if (id) return { surface: "register", account_id: id, transaction_ids: [] };
  }
  const planRows = live.filter((n) =>
    ["month_category", "category", "category_group", "target"].includes(n.type),
  );
  if (planRows.length) {
    const cell = planRows.find((n) => n.type === "month_category");
    const month = (cell?.after?.month ?? cell?.before?.month ?? null) as string | null;
    const cats = planRows
      .filter((n) => n.type !== "category_group")
      .map((n) =>
        n.type === "month_category" ? (n.after?.category_id ?? n.before?.category_id) : n.id,
      )
      .filter((x): x is string => typeof x === "string");
    return {
      surface: "plan",
      month: month as never,
      category_ids: [...new Set(cats)].slice(0, 50),
    };
  }
  const payees = live
    .filter((n) => n.type === "payee" || n.type === "payee_rename_rule")
    .map((n) => (n.type === "payee" ? n.id : (n.before?.payee_id ?? n.after?.payee_id)))
    .filter((x): x is string => typeof x === "string");
  return { surface: "payees", payee_ids: [...new Set(payees)].slice(0, 50) };
}

/** The payee ids the set names, for the stored-default recompute. */
function payeeIdsOf(nets: readonly Net[]): string[] {
  const out = new Set<string>();
  for (const n of nets) {
    if (n.type === "payee") out.add(n.id);
    if (n.type !== "transaction") continue;
    for (const j of [n.before, n.after]) {
      if (typeof j?.payee_id === "string") out.add(j.payee_id);
      for (const l of (j?.subtransactions ?? []) as Json[])
        if (typeof l.payee_id === "string") out.add(l.payee_id);
    }
  }
  return [...out];
}

/** The statements of one undo, in order (test seam: a test appends a failing statement to prove atomicity). */
export function buildUndoBatch(
  c: Ctx,
  undoSetId: string,
  nets: readonly Net[],
): BatchItem<"sqlite">[] {
  const present = new Set(nets.filter((n) => n.kind !== "noop").map((n) => n.type as UndoType));
  const types = (order: readonly UndoType[]) => order.filter((t) => present.has(t));
  const stmts: BatchItem<"sqlite">[] = [];
  for (const t of types(UNDO_TYPES)) stmts.push(undoRepo.staleCheckStmt(c, t));
  for (const t of types(UNDO_TYPES)) stmts.push(...undoRepo.undoLogStmts(c, t));
  for (const t of types(RESTORE_ORDER)) stmts.push(...undoRepo.restoreStmts(c, t));
  for (const t of types(REMOVE_ORDER)) stmts.push(...undoRepo.softDeleteStmts(c, t));
  const recompute = undoRepo.recomputeStmt(c, payeeIdsOf(nets));
  if (recompute) stmts.push(recompute);
  stmts.push(...undoRepo.postChecks(c, present));
  stmts.push(undoRepo.recordStmt(c, undoSetId));
  return stmts;
}

/** A drizzle statement (builder or raw) as a D1 prepared statement: drizzle's own batch cannot take raw SQL. */
function prepared(d1: D1Database, s: unknown): D1PreparedStatement {
  const x = s as {
    toSQL?: () => { sql: string; params: unknown[] };
    getQuery?: () => { sql: string; params: unknown[] };
  };
  const q = (x.toSQL ? x.toSQL() : x.getQuery?.()) as { sql: string; params: unknown[] };
  return d1.prepare(q.sql).bind(...q.params);
}

function messages(e: unknown): string {
  const out: string[] = [];
  for (let x: unknown = e; x instanceof Error && out.length < 6; x = x.cause) out.push(x.message);
  return out.join(" | ");
}

/** Maps the error of a failed batch to the refusal it means; anything else is rethrown by the caller. */
function mapWriteError(e: unknown): UndoRefused | null {
  const m = messages(e);
  if (m.includes("change_set_undos.undo_change_set_id"))
    return new UndoRefused(409, "undo_stale", UNDO_ERRORS.undo_stale);
  if (m.includes("change_set_undos.actor"))
    return new UndoRefused(409, "undo_refused", UNDO_ERRORS.undo_refused);
  if (m.includes("UNIQUE constraint failed: change_set_undos"))
    return new UndoRefused(409, "already_undone", UNDO_ERRORS.already_undone);
  if (
    /UNIQUE constraint failed: (transactions|payees|payee_rename_rules|categories|category_groups)\b/.test(
      m,
    )
  )
    return new UndoRefused(409, "undo_stale", UNDO_ERRORS.undo_stale);
  return null;
}

const DETAIL_NAME: Record<string, string> = {
  category_group: "category group",
  payee_rename_rule: "rename rule",
  scheduled_transaction: "scheduled transaction",
  month_category: "month cell",
};

/**
 * Reverses everything one change set wrote, in ONE db.batch after ONE read batch (a constant number of D1 calls).
 * Check order: not_found, forbidden, already_undone, undo_refused, undo_stale, then the write batch.
 */
export async function undoChangeSet(
  env: Env,
  actor: string,
  budgetId: string,
  changeSetId: string,
): Promise<UndoResult> {
  if (!isUuid(budgetId) || !isUuid(changeSetId))
    throw new UndoRefused(404, "not_found", "Change set not found");
  if (currentChangeSetId() === null)
    return runInChangeSet(crypto.randomUUID(), () =>
      undoChangeSet(env, actor, budgetId, changeSetId),
    );
  const undoSetId = currentChangeSetId() as string;
  const db = getDb(env);
  const now = new Date().toISOString();
  const base = { db, budgetId, setId: changeSetId, actor, now, moveId: crypto.randomUUID() };

  const results = (
    await env.DB.batch<never>(
      undoRepo.readSetStmts({ ...base, ruleTexts: "[]" }).map((x) => prepared(env.DB, x)),
    )
  ).map((r) => r.results) as unknown[][];
  const [rowsRes, recorded, plan, systemRes, ...finders] = results as [
    Row[],
    unknown[],
    unknown[],
    { t: string; id: string }[],
    ...{ t: string; id: string }[][],
  ];
  if (plan.length === 0 || rowsRes.length === 0)
    throw new UndoRefused(404, "not_found", "Change set not found");
  if (rowsRes.some((r) => r.actor !== actor))
    throw new UndoRefused(403, "forbidden", UNDO_ERRORS.forbidden);
  if (recorded.length > 0) throw new UndoRefused(409, "already_undone", UNDO_ERRORS.already_undone);

  const nets = netOf(rowsRes);
  refusals(nets, new Set(systemRes.map((s) => `${s.t}:${s.id}`)));
  for (const f of finders) {
    const hit = f[0];
    if (hit)
      throw new UndoRefused(
        409,
        "undo_stale",
        `${DETAIL_NAME[hit.t] ?? hit.t.replace("_", " ")} ${hit.id} changed after this action, so it can't be undone`,
      );
  }

  const ruleTexts = JSON.stringify(
    nets
      .filter((n) => n.type === "payee_rename_rule" && n.kind !== "noop")
      .map((n) => ({ id: n.id, m: foldRuleText(String((n.before ?? n.after)?.text ?? "")) })),
  );
  const stmts = buildUndoBatch({ ...base, ruleTexts }, undoSetId, nets);
  try {
    await env.DB.batch(stmts.map((x) => prepared(env.DB, x)));
  } catch (e) {
    const refused = mapWriteError(e);
    if (refused) throw refused;
    throw e;
  }
  return {
    change_set_id: undoSetId,
    undone_change_set_id: changeSetId,
    entities: nets.filter((n) => n.kind !== "noop").length,
    where: whereOf(nets),
  };
}
