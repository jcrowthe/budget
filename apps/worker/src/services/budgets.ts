import type { BankEnvironment, Budget, BudgetCreate, BudgetUpdate } from "@budget/schema/budgets";
import {
  currencyByCode,
  currencyFormatOf,
  DATE_FORMAT_OPTIONS,
  DEFAULT_STORED_FORMATS,
  NUMBER_FORMATS,
  type Placement,
  placementOf,
  type StoredFormats,
} from "@budget/schema/plan-formats-catalogue";
import type { DateFormat } from "@budget/schema/plan-import-read";
import { FLAG_COLORS, type FlagNames } from "@budget/schema/transactions";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as repo from "../repositories/budgets";
import { accountFacts, accountToApi } from "./accounts";
import { defaultCategoryStmts } from "./default-categories";

/** The plan's flag names from its stored JSON (all six keys; bad or missing JSON gives the defaults). */
export function parseFlagNames(stored: string | null | undefined): FlagNames {
  const out: FlagNames = {
    red: null,
    orange: null,
    yellow: null,
    green: null,
    blue: null,
    purple: null,
  };
  if (!stored) return out;
  try {
    const v: unknown = JSON.parse(stored);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const c of FLAG_COLORS) {
        const n = (v as Record<string, unknown>)[c];
        if (typeof n === "string" && n.trim() !== "") out[c] = n;
      }
    }
  } catch {
    // bad JSON: the defaults
  }
  return out;
}

/** The names of a plan row already read. */
export function flagNamesOfRow(row: Pick<repo.BudgetRow, "flagNames">): FlagNames {
  return parseFlagNames(row.flagNames);
}

const MAX_FLAG_NAME = 50;

export function toApi(row: repo.BudgetRow): Budget {
  return {
    id: row.id,
    name: row.name,
    created_at: row.createdAt,
    last_modified_on: row.updatedAt,
    last_opened_at: row.lastOpenedAt ?? null,
    bank_environment: row.bankEnvironment,
    currency_format: currencyFormatOf(row.currencyIsoCode, row.numberFormat, row.symbolPlacement),
    date_format: { format: row.dateFormat as DateFormat },
    expected_income: row.expectedIncome ?? null,
    flag_names: flagNamesOfRow(row),
  };
}

/** A refused plan setting: 422 with a named code. Nothing was written. */
export class BudgetRefused extends Error {
  readonly status = 422 as const;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BudgetRefused";
  }
}

export function storedFormatsOf(
  row: Pick<repo.BudgetRow, "currencyIsoCode" | "numberFormat" | "symbolPlacement" | "dateFormat">,
): StoredFormats {
  return {
    iso_code: row.currencyIsoCode,
    example_format: row.numberFormat,
    symbol_placement: row.symbolPlacement,
    date_format: row.dateFormat as DateFormat,
  };
}

/** The plan's formats as the screens and files read them, from a row already read. */
export function formatsOfRow(row: repo.BudgetRow) {
  const b = toApi(row);
  return { currency_format: b.currency_format, date_format: b.date_format };
}

export interface FormatsInput {
  currency_format?: { iso_code?: string; example_format?: string; symbol_placement?: Placement };
  date_format?: { format: string };
}

/** Pure: the stored formats after an input, or a BudgetRefused. A currency change takes its defaults. */
export function resolveFormats(stored: StoredFormats, input: FormatsInput): StoredFormats {
  const next = { ...stored };
  const cf = input.currency_format;
  if (cf) {
    const code = cf.iso_code ?? stored.iso_code;
    const cur = currencyByCode(code);
    if (!cur) {
      throw new BudgetRefused(
        "unknown_currency",
        `Unknown currency ${code}. Use a code of the plan settings list.`,
      );
    }
    const changed = code !== stored.iso_code;
    next.iso_code = code;
    next.example_format =
      cf.example_format ?? (changed ? cur.number_format : stored.example_format);
    next.symbol_placement =
      cf.symbol_placement ?? (changed ? cur.placement : stored.symbol_placement);
    const offered = NUMBER_FORMATS[cur.decimal_digits];
    if (!offered.includes(next.example_format)) {
      throw new BudgetRefused(
        "number_format_not_offered",
        `${next.example_format} is not a number format of ${code}; use one of ${offered.join(", ")}.`,
      );
    }
  }
  if (input.date_format) {
    const f = input.date_format.format;
    if (!(DATE_FORMAT_OPTIONS as readonly string[]).includes(f)) {
      throw new BudgetRefused(
        "unknown_date_format",
        `Unknown date format ${f}; use one of ${DATE_FORMAT_OPTIONS.join(", ")}.`,
      );
    }
    next.date_format = f as DateFormat;
  }
  return next;
}

function formatColumns(f: StoredFormats) {
  return {
    currencyIsoCode: f.iso_code,
    numberFormat: f.example_format,
    symbolPlacement: f.symbol_placement,
    dateFormat: f.date_format,
  };
}

export async function listBudgets(env: Env): Promise<Budget[]> {
  return (await repo.listActive(getDb(env))).map(toApi);
}

export async function getBudget(env: Env, id: string): Promise<Budget> {
  const row = await repo.findActive(getDb(env), id);
  if (!row) throw new NotFound("Plan");
  return toApi(row);
}

/** Test seam: builds the create batch with a custom change_log entry (to prove atomicity). */
export function buildCreateBatch(db: Db, row: repo.NewBudgetRow, log: ChangeLogEntry) {
  return [repo.insertStmt(db, row), changeLogInsert(db, log)] as const;
}

export async function getBudgetEnvironment(env: Env, budgetId: string): Promise<BankEnvironment> {
  return (await getBudget(env, budgetId)).bank_environment;
}

export async function createBudget(env: Env, actor: string, input: BudgetCreate): Promise<Budget> {
  const db = getDb(env);
  const now = new Date().toISOString();
  const formats = resolveFormats(DEFAULT_STORED_FORMATS, input);
  const row: repo.BudgetRow = {
    id: crypto.randomUUID(),
    name: input.name,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    lastOpenedAt: null,
    bankEnvironment: input.bank_environment ?? "production",
    expectedIncome: null,
    flagNames: null,
    ...formatColumns(formats),
  };
  const batch = buildCreateBatch(db, row, {
    budgetId: row.id,
    actor,
    action: "create",
    entityType: "budget",
    entityId: row.id,
    before: null,
    after: toApi(row),
  });
  await db.batch([...batch, ...defaultCategoryStmts(db, row.id, actor, now)]);
  return toApi(row);
}

/** After a guarded batch changed 0 rows: the plan is gone (404) or was modified by someone else (409). */
async function lostRace(db: Db, id: string): Promise<never> {
  if (await repo.findActive(db, id)) throw new Conflict("Plan");
  throw new NotFound("Plan");
}

/**
 * Mutations on an existing row: the change_log insert comes FIRST and the UPDATE second, both guarded by
 * "the row is still exactly what was read". A lost race therefore writes neither, and the log never
 * records a change that did not happen.
 */
export async function updateBudget(
  env: Env,
  actor: string,
  id: string,
  patch: BudgetUpdate,
): Promise<Budget> {
  const db = getDb(env);
  const before = await repo.findActive(db, id);
  if (!before) throw new NotFound("Plan");
  const now = new Date().toISOString();
  // Opening a plan is not a change: no change_log, no last_modified_on bump (EXF-475).
  if (
    patch.opened === true &&
    patch.name === undefined &&
    patch.bank_environment === undefined &&
    patch.currency_format === undefined &&
    patch.date_format === undefined &&
    patch.expected_income === undefined &&
    patch.flag_names === undefined
  ) {
    const res = await repo.markOpenedStmt(db, id, now);
    if (res.meta.changes === 0) throw new NotFound("Plan");
    return toApi({ ...before, lastOpenedAt: now });
  }
  if (patch.expected_income !== undefined && patch.expected_income !== null) {
    if (patch.expected_income < 0) {
      throw new BudgetRefused(
        "negative_expected_income",
        "expected_income must be 0 or more (0 or null clears it)",
      );
    }
  }
  // 0 and null both clear it.
  const expectedIncome =
    patch.expected_income === undefined ? undefined : patch.expected_income || null;
  // EXF-480: merge onto the stored names; only non-empty trimmed names are stored, NULL when none.
  let flagNames: string | null | undefined;
  if (patch.flag_names !== undefined) {
    const merged = flagNamesOfRow(before);
    if (patch.flag_names === null) {
      for (const c of FLAG_COLORS) merged[c] = null;
    } else {
      for (const [key, value] of Object.entries(patch.flag_names)) {
        if (!(FLAG_COLORS as readonly string[]).includes(key)) {
          throw new BudgetRefused("unknown_flag_color", `Unknown flag colour: ${key}`);
        }
        if (value === undefined) continue;
        const t = value === null ? "" : value.trim();
        if (t.length > MAX_FLAG_NAME) {
          throw new BudgetRefused(
            "flag_name_too_long",
            `A flag name is at most ${MAX_FLAG_NAME} characters`,
          );
        }
        merged[key as keyof FlagNames] = t === "" ? null : t;
      }
    }
    const kept = Object.fromEntries(
      FLAG_COLORS.flatMap((c) => (merged[c] ? [[c, merged[c]]] : [])),
    );
    flagNames = Object.keys(kept).length === 0 ? null : JSON.stringify(kept);
  }
  const lastOpenedAt = patch.opened === true ? now : undefined;
  const formatPatch =
    patch.currency_format === undefined && patch.date_format === undefined
      ? {}
      : formatColumns(resolveFormats(storedFormatsOf(before), patch));
  const after = {
    ...before,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.bank_environment === undefined ? {} : { bankEnvironment: patch.bank_environment }),
    ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
    ...(expectedIncome === undefined ? {} : { expectedIncome }),
    ...(flagNames === undefined ? {} : { flagNames }),
    ...formatPatch,
    updatedAt: now,
  };
  const [, result] = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: id,
        actor,
        action: "update",
        entityType: "budget",
        entityId: id,
        before: toApi(before),
        after: toApi(after),
      },
      repo.existsUnchanged(db, before),
    ),
    repo.updateStmt(
      db,
      before,
      {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.bank_environment === undefined
          ? {}
          : { bankEnvironment: patch.bank_environment }),
        ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
        ...(expectedIncome === undefined ? {} : { expectedIncome }),
        ...(flagNames === undefined ? {} : { flagNames }),
        ...formatPatch,
      },
      now,
    ),
  ]);
  if (result.meta.changes === 0) return lostRace(db, id);
  return toApi(after);
}

/** EXF-525: sets the plan's expected monthly income (0 or null clears it; a negative is refused). */
export async function setExpectedIncome(
  env: Env,
  actor: string,
  id: string,
  value: number | null,
): Promise<Budget> {
  return updateBudget(env, actor, id, { expected_income: value });
}

/** EXF-480: sets the plan's flag names (merge; null or blank clears one; null resets all). */
export async function setFlagNames(
  env: Env,
  actor: string,
  id: string,
  names: NonNullable<BudgetUpdate["flag_names"]> | null,
): Promise<Budget> {
  return updateBudget(env, actor, id, { flag_names: names });
}

/**
 * Deleting a plan unlinks its linked accounts in the same batch, each with its history row, so no hidden link
 * is left (EXF-824). The plan's log row and delete hold only while no account is linked except the ones read;
 * each unlink holds only while its account is still linked as read and the plan's deleted_at is this delete's
 * time. A link made since the read therefore makes the whole delete write nothing (409).
 */
export async function deleteBudget(env: Env, actor: string, id: string): Promise<void> {
  const db = getDb(env);
  const [before, linked] = await Promise.all([
    repo.findActive(db, id),
    accountsRepo.linkedInPlan(db, id),
  ]);
  if (!before) throw new NotFound("Plan");
  if (linked.length > accountsRepo.MAX_LINKS_AS_READ) throw new Conflict("Plan");
  const at = new Date().toISOString();
  const facts = linked.length ? await accountFacts(db, id) : null;
  // Built first, so no unlink row is dated after the plan's delete row.
  const unlinks = facts
    ? linked.flatMap((row) => [
        changeLogInsertIf(
          db,
          {
            budgetId: id,
            actor,
            action: "update",
            entityType: "account",
            entityId: row.id,
            before: accountToApi(row, facts(row)),
            after: accountToApi(
              { ...row, bankAccountId: null, importStartDate: null, linkMissingSince: null },
              facts(row),
            ),
          },
          accountsRepo.unlinkAfterDeleteHolds(db, row, at),
        ),
        accountsRepo.unlinkAfterDeleteStmt(db, row, at),
      ])
    : [];
  const guard = accountsRepo.linksAsRead(id, linked);
  const [, result] = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: id,
        actor,
        action: "delete",
        entityType: "budget",
        entityId: id,
        before: toApi(before),
        after: null,
      },
      repo.existsUnchanged(db, before, guard),
    ),
    repo.softDeleteStmt(db, before, at, guard),
    ...unlinks,
  ]);
  if (result.meta.changes === 0) await lostRace(db, id);
}
