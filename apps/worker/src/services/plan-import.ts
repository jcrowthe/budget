import { formatsFromImport } from "@budget/schema/plan-formats-catalogue";
import {
  buildImportPlan,
  IMPORT_LIMITS,
  type ImportFormats,
  type ImportPlan,
  type ImportSummary,
  type PlanImportCancelResult,
  type PlanImportOptions,
  type PlanImportPreview,
  type PlanImportResult,
} from "@budget/schema/plan-import";
import { ImportError, identifyFiles, type NamedText } from "@budget/schema/plan-import-read";
import { isZip, unzip, ZipError } from "@budget/schema/zip";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsert } from "../history/change-log";
import type * as budgetsRepo from "../repositories/budgets";
import { recomputeDefaultsStmt } from "../repositories/payee-category";
import * as repo from "../repositories/plan-import";

import { toApi } from "./budgets";
import { planClock } from "./plan-clock";
import { compareImport } from "./plan-import-compare";

/**
 * Import Plan (docs/plan-import-design.md): a new plan from an export zip or its two files. A small file is written
 * by one batch; a large one in steps driven by the caller (`continueImport`), the plan hidden until the last step.
 * D1 calls per invocation do not grow with the file: see the table in the design.
 */
export const importLimits = {
  singleCallRows: 2500,
  chunkRows: 2500,
  rowsPerStatement: 250,
  staleMs: 24 * 3600_000,
  keyGraceMs: 3600_000,
};
export const IMPORT_PREFIX = "plan-imports/";
export const IMPORT_TEXT = "Imported plan from file";

/** A rule of the import failed; the route answers with this status and code. */
export class ImportRefused extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "ImportRefused";
  }
}

/** Inflates a raw deflate stream whose entry has `size` bytes (the Worker runtime's DecompressionStream). */
export async function inflateRaw(data: Uint8Array, size: number): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const out = new Uint8Array(size);
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > size) {
        await reader.cancel();
        throw new ZipError("zip_crc", "A file in the ZIP is damaged (CRC mismatch)");
      }
      out.set(value, n);
      n += value.length;
    }
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError("zip_corrupt", "The file is not a readable ZIP");
  }
  return n === size ? out : out.subarray(0, n);
}

const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function decode(name: string, bytes: Uint8Array): NamedText {
  try {
    return { name, text: dec.decode(bytes) };
  } catch {
    throw new ImportError("not_utf8", `${name} is not UTF-8 text`);
  }
}

const day = (iso: string) => iso.slice(0, 10);

function summaryOf(plan: ImportPlan, cmp: ReturnType<typeof compareImport>): ImportSummary {
  return {
    name: plan.name,
    export_date: plan.exportDate,
    file_names: plan.fileNames,
    first_month: plan.months[0] ?? null,
    last_month: plan.months[plan.months.length - 1] ?? null,
    formats: plan.formats,
    accounts: plan.accounts.map((a) => ({
      name: a.name,
      type: a.type,
      proposed_type: a.proposedType,
      reason: a.reason,
      on_budget: a.onBudget,
      transactions: a.transactions,
    })),
    counts: plan.counts,
    warnings: plan.warnings,
    warning_count: plan.warningCount,
    mismatches: cmp.mismatches,
    mismatch_count: cmp.mismatchCount,
  };
}

/** The question of an unclear date as the text of a 422. */
function questionText(plan: ImportPlan): string {
  const q = plan.dateQuestion;
  if (!q) return "";
  const opts = q.options.map((o) => `${o.date_format} (${o.date})`).join(" or ");
  return `${q.question} Answer with date_format: ${opts}.`;
}

async function readPlan(
  upload: { files: { name: string; bytes: Uint8Array }[]; options: PlanImportOptions },
  serverToday: string,
): Promise<{ plan: ImportPlan; summary: ImportSummary }> {
  const total = upload.files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > IMPORT_LIMITS.uploadBytes)
    throw new ImportError("too_large", "The upload is larger than 20 MiB");
  let zipName: string | null = null;
  let texts: NamedText[];
  const first = upload.files[0];
  if (upload.files.length === 1 && first && isZip(first.bytes)) {
    zipName = first.name;
    const entries = await unzip(first.bytes, inflateRaw, {}, (name) => /\.(csv|tsv)$/i.test(name));
    texts = entries.map((e) => decode(e.name.slice(e.name.lastIndexOf("/") + 1), e.data));
  } else {
    texts = upload.files.map((f) => decode(f.name, f.bytes));
  }
  const found = identifyFiles(texts);
  const plan = buildImportPlan({
    plan: found.plan,
    register: found.register,
    settings: found.settings,
    settingsDelimiter: found.settingsDelimiter,
    delimiter: found.delimiter,
    planDelimiter: found.planDelimiter,
    zipName,
    options: upload.options,
    serverToday,
  });
  return { plan, summary: summaryOf(plan, compareImport(plan)) };
}

interface Built {
  budget: budgetsRepo.BudgetRow;
  parts: repo.ChunkPart[];
  rows: number;
}

/** The four plan format columns of what the file's formats say (design: "Files"). */
function importedFormatColumns(f: ImportFormats) {
  const s = formatsFromImport(f);
  return {
    currencyIsoCode: s.iso_code,
    numberFormat: s.example_format,
    symbolPlacement: s.symbol_placement,
    dateFormat: s.date_format,
  };
}

/** Ids and timestamps of every row; each row's time is the start plus its position in the Register, in ms. */
function buildRows(plan: ImportPlan, started: string, budgetId: string): Built {
  const startMs = Date.parse(started);
  const at = (order: number) => new Date(startMs + order).toISOString();
  const firstMonth = plan.firstMonth ? `${plan.firstMonth}T00:00:00.000Z` : started;
  const createdAt = firstMonth < started ? firstMonth : started;
  const budget: budgetsRepo.BudgetRow = {
    id: budgetId,
    name: plan.name,
    createdAt,
    updatedAt: started,
    deletedAt: null,
    lastOpenedAt: null,
    bankEnvironment: "production",
    ...importedFormatColumns(plan.formats),
    expectedIncome: plan.settings.expectedIncome,
    flagNames:
      Object.keys(plan.settings.flagNames).length === 0
        ? null
        : JSON.stringify(plan.settings.flagNames),
  };
  const id = () => crypto.randomUUID();
  const accountIds = plan.accounts.map(id);
  const groupIds = plan.groups.map(id);
  const categoryIds = plan.categories.map(id);
  const payeeIds = plan.payees.map(id);
  const txIds = plan.transactions.map(id);
  const schedIds = plan.schedules.map(id);
  const parts: repo.ChunkPart[] = [
    {
      t: "accounts",
      rows: plan.accounts.map((a, i) => [
        accountIds[i],
        a.name,
        a.type,
        a.onBudget ? 1 : 0,
        a.sort,
        started,
        a.loan?.interestRate ?? null,
        a.loan?.minimumPayment ?? null,
        a.loan?.escrowAmount ?? null,
        a.loan?.pairedCategory == null ? null : categoryIds[a.loan.pairedCategory],
      ]),
    },
    {
      t: "category_groups",
      rows: plan.groups.map((g, i) => [groupIds[i], g.name, g.sort, g.kind, started, started]),
    },
    {
      t: "categories",
      rows: plan.categories.map((c, i) => [
        categoryIds[i],
        groupIds[c.group],
        c.name,
        c.sort,
        c.hidden ? 1 : 0,
        c.paymentAccount === null ? null : "credit_card_payment",
        c.paymentAccount === null ? null : accountIds[c.paymentAccount],
        started,
        started,
      ]),
    },
    {
      // Saved built-in positions and custom views, each at its stored place; members are this plan's category ids.
      t: "plan_views",
      rows: plan.settings.views.map((v) => [
        v.builtinKey === null ? id() : `builtin:${budgetId}:${v.builtinKey}`,
        v.builtinKey,
        v.name,
        JSON.stringify(v.categories.map((c) => categoryIds[c])),
        v.position,
        started,
        started,
      ]),
    },
    {
      t: "payees",
      rows: plan.payees.map((p, i) => [payeeIds[i], p.name, p.system, started, started]),
    },
    {
      // Each rule one millisecond after the one before it: the order of creation is the file's order.
      t: "payee_rename_rules",
      rows: plan.renameRules.map((r, i) => [
        id(),
        payeeIds[r.payee],
        r.kind,
        r.text,
        r.matchText,
        at(i),
      ]),
    },
    {
      t: "month_categories",
      rows: plan.assignments.map((a) => [a.month, categoryIds[a.category], a.assigned, started]),
    },
    {
      t: "transactions",
      rows: plan.transactions.map((t, i) => [
        txIds[i],
        accountIds[t.account],
        t.date,
        t.payee === null ? null : payeeIds[t.payee],
        t.payeeName,
        t.category === null ? null : categoryIds[t.category],
        t.inflowToRta ? 1 : 0,
        t.memo,
        t.amount,
        t.cleared,
        t.flag,
        t.transferAccount === null ? null : accountIds[t.transferAccount],
        t.transfer === null ? null : txIds[t.transfer],
        t.parent === null ? null : txIds[t.parent],
        t.splitIndex,
        at(t.order),
        at(t.order),
      ]),
    },
    {
      t: "scheduled_transactions",
      rows: plan.schedules.map((s, i) => [
        schedIds[i],
        accountIds[s.account],
        s.date,
        s.date,
        s.amount,
        s.payee === null ? null : payeeIds[s.payee],
        s.category === null ? null : categoryIds[s.category],
        s.inflowToRta ? 1 : 0,
        s.memo,
        s.flag,
        id(),
        at(s.order),
        at(s.order),
        s.transferAccount === null ? null : accountIds[s.transferAccount],
      ]),
    },
    {
      t: "scheduled_subtransactions",
      rows: plan.schedules.flatMap((s, i) =>
        s.lines.map((l, k) => [
          id(),
          schedIds[i],
          l.amount,
          l.payee === null ? null : payeeIds[l.payee],
          l.category === null ? null : categoryIds[l.category],
          l.inflowToRta ? 1 : 0,
          l.memo,
          k,
          at(s.order),
          at(s.order),
        ]),
      ),
    },
  ];
  return { budget, parts, rows: parts.reduce((n, p) => n + p.rows.length, 0) };
}

/** Cuts the parts, in dependency order, into chunks of at most `size` rows. */
function chunksOf(parts: repo.ChunkPart[], size: number): repo.ChunkPart[][] {
  const chunks: repo.ChunkPart[][] = [];
  let current: repo.ChunkPart[] = [];
  let room = size;
  for (const part of parts) {
    for (let i = 0; i < part.rows.length; ) {
      const take = Math.min(room, part.rows.length - i);
      current.push({ t: part.t, rows: part.rows.slice(i, i + take) });
      i += take;
      room -= take;
      if (room === 0) {
        chunks.push(current);
        current = [];
        room = size;
      }
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function historyEntry(
  budget: budgetsRepo.BudgetRow,
  actor: string,
  importId: string,
  summary: ImportSummary,
): ChangeLogEntry {
  return {
    budgetId: budget.id,
    actor,
    action: "create",
    entityType: "budget",
    entityId: budget.id,
    before: null,
    after: {
      ...toApi(budget),
      import: {
        text: IMPORT_TEXT,
        import_id: importId,
        file_name: summary.file_names.register,
        export_date: summary.export_date,
        counts: summary.counts,
        formats: summary.formats,
        warning_count: summary.warning_count,
        mismatch_count: summary.mismatch_count,
      },
    },
  };
}

function resultOf(row: repo.PlanImportRow, summary: ImportSummary): PlanImportResult {
  return {
    import_id: row.id,
    state: row.state === "done" ? "done" : "writing",
    budget_id: row.state === "done" ? row.budgetId : null,
    progress: { chunks_done: row.nextChunk, chunk_count: row.chunkCount },
    summary,
  };
}

/** Removes what is left of an unfinished import and its stored file (guarded: it never matches a visible plan). */
async function cleanUp(env: Env, row: repo.PlanImportRow, now: string): Promise<boolean> {
  const db = getDb(env);
  const stmts = repo.cleanupStmts(db, { importId: row.id, budgetId: row.budgetId, now });
  const results = (await db.batch(
    stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]],
  )) as { meta: { changes: number } }[];
  // The last statement marks the import abandoned only while it is still writing: no change means a
  // concurrent call finished (or already cleaned) it, and its stored file is not ours to delete.
  const abandoned = (results[results.length - 1]?.meta.changes ?? 0) > 0;
  if (abandoned && row.r2Key) await env.FILES.delete(row.r2Key);
  return abandoned;
}

/** Cleans at most one stale import: an unfinished one untouched for a day, or a finished one whose file was kept. */
async function sweep(env: Env, now: Date): Promise<void> {
  const db = getDb(env);
  const old = await repo.findSweepable(db, {
    staleBefore: new Date(now.getTime() - importLimits.staleMs).toISOString(),
    keyBefore: new Date(now.getTime() - importLimits.keyGraceMs).toISOString(),
  });
  if (!old) return;
  if (old.state === "writing") await cleanUp(env, old, now.toISOString());
  else {
    if (old.r2Key) await env.FILES.delete(old.r2Key);
    await db.batch([repo.clearKeyStmt(db, old.id)]);
  }
}

export async function startImport(
  env: Env,
  actor: string,
  upload: {
    files: { name: string; bytes: Uint8Array }[];
    options: PlanImportOptions;
    dryRun: boolean;
  },
): Promise<
  { status: 200; preview: PlanImportPreview } | { status: 201 | 202; result: PlanImportResult }
> {
  const now = planClock.now();
  const { plan, summary } = await readPlan(upload, day(now.toISOString()));
  if (upload.dryRun) {
    return { status: 200, preview: { ...summary, date_question: plan.dateQuestion } };
  }
  if (plan.dateQuestion) throw new ImportRefused(422, "date_format_unclear", questionText(plan));

  await sweep(env, now);
  const db = getDb(env);
  const started = now.toISOString();
  const importId = crypto.randomUUID();
  const budgetId = crypto.randomUUID();
  const built = buildRows(plan, started, budgetId);
  const summaryJson = JSON.stringify(summary);
  const fileName = plan.fileNames.register;

  if (built.rows <= importLimits.singleCallRows) {
    const row: repo.PlanImportRow = {
      id: importId,
      budgetId,
      state: "done",
      actor,
      fileName,
      r2Key: null,
      chunkCount: 1,
      nextChunk: 1,
      chunkOffsets: "[]",
      summaryJson,
      createdAt: started,
      updatedAt: started,
      finishedAt: started,
    };
    await db.batch([
      repo.insertPlanStmt(db, built.budget),
      ...repo.insertRowsStmts(db, budgetId, built.parts, null, importLimits.rowsPerStatement),
      // The payees' stored defaults follow the imported history, in the same batch.
      ...recompute(db, budgetId),
      changeLogInsert(db, historyEntry(built.budget, actor, importId, summary)),
      repo.insertImportStmt(db, row),
    ]);
    return { status: 201, result: resultOf(row, summary) };
  }

  const chunks = chunksOf(built.parts, importLimits.chunkRows);
  const enc = new TextEncoder();
  const encoded = chunks.map((c) => enc.encode(JSON.stringify(c)));
  const buffer = new Uint8Array(encoded.reduce((n, e) => n + e.length, 0));
  const offsets: { offset: number; length: number }[] = [];
  let p = 0;
  for (const e of encoded) {
    offsets.push({ offset: p, length: e.length });
    buffer.set(e, p);
    p += e.length;
  }
  const key = `${IMPORT_PREFIX}${importId}/chunks`;
  const row: repo.PlanImportRow = {
    id: importId,
    budgetId,
    state: "writing",
    actor,
    fileName,
    r2Key: key,
    chunkCount: chunks.length,
    nextChunk: 0,
    chunkOffsets: JSON.stringify(offsets),
    summaryJson,
    createdAt: started,
    updatedAt: started,
    finishedAt: null,
  };
  // The plan is written hidden: nothing reads it until the last step clears deleted_at.
  await db.batch([
    repo.insertPlanStmt(db, { ...built.budget, deletedAt: started }),
    repo.insertImportStmt(db, row),
  ]);
  try {
    await env.FILES.put(key, buffer);
  } catch (e) {
    await cleanUp(env, row, started);
    throw e;
  }
  return { status: 202, result: resultOf(row, summary) };
}

export async function continueImport(
  env: Env,
  importId: string,
): Promise<{ status: 201 | 202; result: PlanImportResult }> {
  const db = getDb(env);
  const row = await repo.find(db, importId);
  if (!row) throw new ImportRefused(404, "not_found", "Import not found");
  return stepOf(env, row);
}

const ABANDONED = "This import was cancelled or expired; start again";
const FAILED = "The import failed while writing; nothing was kept";

/**
 * Cleans an import that cannot go on and raises `refusal`; but when the cleanup changed nothing because a
 * concurrent call finished the import, answers the state as it is (done: 201) instead of telling the caller to start again.
 */
async function giveUp(
  env: Env,
  row: repo.PlanImportRow,
  now: string,
  refusal: ImportRefused,
): Promise<{ status: 201; result: PlanImportResult }> {
  if (await cleanUp(env, row, now)) throw refusal;
  const again = await repo.find(getDb(env), row.id);
  if (again?.state === "done") {
    return { status: 201, result: resultOf(again, JSON.parse(again.summaryJson) as ImportSummary) };
  }
  if (!again) throw new ImportRefused(404, "not_found", "Import not found");
  throw new ImportRefused(409, "import_abandoned", ABANDONED);
}

async function stepOf(
  env: Env,
  row: repo.PlanImportRow,
): Promise<{ status: 201 | 202; result: PlanImportResult }> {
  const db = getDb(env);
  if (row.state === "abandoned") throw new ImportRefused(409, "import_abandoned", ABANDONED);
  const summary = JSON.parse(row.summaryJson) as ImportSummary;
  if (row.state === "done") return { status: 201, result: resultOf(row, summary) };

  const now = planClock.now().toISOString();
  const n = row.nextChunk;
  const offsets = JSON.parse(row.chunkOffsets) as { offset: number; length: number }[];
  const where = offsets[n];
  const object =
    row.r2Key && where
      ? await env.FILES.get(row.r2Key, { range: { offset: where.offset, length: where.length } })
      : null;
  if (!object) {
    return giveUp(env, row, now, new ImportRefused(409, "import_abandoned", ABANDONED));
  }
  let parts: repo.ChunkPart[];
  try {
    parts = JSON.parse(await object.text()) as repo.ChunkPart[];
  } catch {
    return giveUp(env, row, now, new ImportRefused(422, "import_failed", FAILED));
  }
  const last = n === row.chunkCount - 1;
  const stmts = [
    ...repo.insertRowsStmts(
      db,
      row.budgetId,
      parts,
      { importId: row.id, chunk: n },
      importLimits.rowsPerStatement,
    ),
    ...(last
      ? repo.revealStmts(db, {
          importId: row.id,
          chunk: n,
          budgetId: row.budgetId,
          now,
          log: historyEntry(
            {
              id: row.budgetId,
              name: summary.name,
              createdAt:
                summary.first_month && `${summary.first_month}T00:00:00.000Z` < row.createdAt
                  ? `${summary.first_month}T00:00:00.000Z`
                  : row.createdAt,
              updatedAt: now,
              deletedAt: null,
              lastOpenedAt: null,
              bankEnvironment: "production",
              ...importedFormatColumns(summary.formats),
            },
            row.actor,
            row.id,
            summary,
          ),
        })
      : []),
    // Last step only: every row is in, so the stored defaults follow the whole history (advanceStmt stays last).
    ...(last ? recompute(db, row.budgetId) : []),
    repo.advanceStmt(db, row.id, n, now, last),
  ];
  let results: { meta: { changes: number } }[];
  try {
    results = (await db.batch(
      stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]],
    )) as typeof results;
  } catch {
    return giveUp(env, row, now, new ImportRefused(422, "import_failed", FAILED));
  }
  if ((results[results.length - 1]?.meta.changes ?? 0) === 0) {
    // Another call took this step (a repeat after a lost answer, or two at once): answer the state as it is.
    const again = await repo.find(db, row.id);
    if (!again) throw new ImportRefused(404, "not_found", "Import not found");
    if (again.state === "writing" && again.nextChunk === n) {
      throw new ImportRefused(422, "import_failed", "The step did not apply; call continue again");
    }
    if (again.state === "abandoned") throw new ImportRefused(409, "import_abandoned", ABANDONED);
    return { status: again.state === "done" ? 201 : 202, result: resultOf(again, summary) };
  }
  const advanced: repo.PlanImportRow = {
    ...row,
    nextChunk: n + 1,
    updatedAt: now,
    state: last ? "done" : "writing",
    finishedAt: last ? now : null,
  };
  if (last) {
    if (row.r2Key) await env.FILES.delete(row.r2Key);
    await db.batch([repo.clearKeyStmt(db, row.id)]);
    return { status: 201, result: resultOf({ ...advanced, r2Key: null }, summary) };
  }
  return { status: 202, result: resultOf(advanced, summary) };
}

export async function cancelImport(
  env: Env,
  importId: string,
): Promise<ReturnType<typeof PlanImportCancelResult.parse>> {
  const db = getDb(env);
  const row = await repo.find(db, importId);
  if (!row) throw new ImportRefused(404, "not_found", "Import not found");
  if (row.state === "done") {
    throw new ImportRefused(
      409,
      "import_finished",
      "This import has finished; delete the plan instead",
    );
  }
  if (row.state === "writing" && !(await cleanUp(env, row, planClock.now().toISOString()))) {
    // A concurrent call changed the import first: report what it became.
    const again = await repo.find(db, importId);
    if (again?.state === "done") {
      throw new ImportRefused(
        409,
        "import_finished",
        "This import has finished; delete the plan instead",
      );
    }
  }
  return { import_id: importId, state: "abandoned" };
}

/** The plan-wide recompute of the payees' stored defaults, as a batch part. */
function recompute(db: Db, budgetId: string) {
  const stmt = recomputeDefaultsStmt(db, budgetId, "plan");
  return stmt ? [stmt] : [];
}
