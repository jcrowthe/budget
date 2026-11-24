import { isLoanType, isOnBudget } from "@budget/core/account-types";
import {
  autoMap,
  buildFileRows,
  columnLabels,
  FILE_IMPORT_KEEP_DAYS,
  FILE_IMPORT_SWEEP,
  FileImportOptions,
  type FileImportOptions as FileImportOptionsT,
  type FileImportPreviewResult,
  type FileImportResult,
  type FileImportRow,
  MAX_FILE_BYTES,
  MAX_FILE_ROWS,
  RememberedFileOptions,
} from "@budget/schema/file-import";
import {
  decodeFileText,
  FileImportError,
  fileFormatOf,
  type ParsedFile,
  readFileText,
} from "@budget/schema/file-import-read";
import { resolveImportedPayee } from "@budget/schema/imported-payee";
import { categoryFor, MATCH_WINDOW_DAYS, minusDays, pickMatch } from "@budget/schema/plaid-import";
import type { BatchItem } from "drizzle-orm/batch";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import * as accountsRepo from "../repositories/accounts";
import * as repo from "../repositories/file-imports";
import * as importsRepo from "../repositories/imports";
import { recomputeDefaultsStmt } from "../repositories/payee-category";
import * as rulesRepo from "../repositories/payee-rename-rules";
import * as payeesRepo from "../repositories/payees";
import type { LineRow, TransactionRow } from "../repositories/transactions";
import { payeeToApi } from "./payees";
import { planClock } from "./plan-clock";
import { logShape } from "./transactions";

/** A rule of file import failed; the route answers `status` with `code` and this message. */
export class FileImportRefused extends Error {
  constructor(
    public status: 404 | 410 | 413 | 422,
    public code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "FileImportRefused";
  }
}

const DAY_MS = 86_400_000;
const SET_BYTES = 900_000;
const enc = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The rows split so that each part's JSON stays under `max` UTF-8 bytes (a row is never cut). */
export function splitByBytes<T>(rows: readonly T[], max = SET_BYTES): T[][] {
  const out: T[][] = [];
  let part: T[] = [];
  let size = 2;
  for (const r of rows) {
    const n = enc.encode(JSON.stringify(r)).length + 1;
    if (part.length > 0 && size + n > max) {
      out.push(part);
      part = [];
      size = 2;
    }
    part.push(r);
    size += n;
  }
  if (part.length > 0) out.push(part);
  return out;
}

type Stmts = Parameters<Db["batch"]>[0];
const batch = async (db: Db, list: unknown[]): Promise<unknown[][]> =>
  (await db.batch(list as unknown as Stmts)) as unknown as unknown[][];

// ---------------------------------------------------------------------------------------------------- reading

interface FileRead {
  parsed: ParsedFile;
  rowCount: number;
}

/** The file's rows, refused when unreadable or over the cap (before anything is written). */
function readFile(fileName: string, bytes: Uint8Array, options: { no_header: boolean }): FileRead {
  try {
    const text = decodeFileText(bytes, (b, l) => new TextDecoder(l).decode(b));
    const parsed = readFileText(fileName, text);
    const rowCount =
      "cells" in parsed ? parsed.cells.length - (options.no_header ? 0 : 1) : parsed.entries.length;
    if (rowCount > MAX_FILE_ROWS) {
      throw new FileImportRefused(
        422,
        "too_many_rows",
        `The file has ${rowCount} transactions; the most is ${MAX_FILE_ROWS}`,
      );
    }
    return { parsed, rowCount: Math.max(0, rowCount) };
  } catch (e) {
    if (e instanceof FileImportError) throw new FileImportRefused(422, e.code, e.message);
    throw e;
  }
}

const parseOptions = (raw: unknown): FileImportOptionsT => {
  const r = FileImportOptions.safeParse(raw);
  if (!r.success) {
    throw new FileImportRefused(
      422,
      "unprocessable_entity",
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return r.data;
};

/** The options this account and format remember, as the fields they hold. */
function rememberedOf(row: repo.SettingsRow | undefined): Record<string, unknown> {
  if (!row) return {};
  try {
    return RememberedFileOptions.partial().parse(JSON.parse(row.optionsJson));
  } catch {
    return {};
  }
}

const pickRemembered = (o: FileImportOptionsT) => ({
  no_header: o.no_header,
  mapping: o.mapping,
  date_format: o.date_format,
  swap_inflow_outflow: o.swap_inflow_outflow,
  import_memos: o.import_memos,
  swap_payee_memo: o.swap_payee_memo,
});

const dayOf = (iso: string) => iso.slice(0, 10);

const keyOf = (fileId: string, budgetId: string) => `file-imports/${budgetId}/${fileId}`;

// ---------------------------------------------------------------------------------------------------- preview

export interface PreviewInput {
  budgetId: string;
  accountId: string;
  fileName: string;
  bytes: Uint8Array;
  /** The request's options as sent (raw): a field left out takes the remembered value, then the default. */
  options?: Record<string, unknown>;
}

/**
 * Reads the file against the account, stores it (R2 and one `file_imports` row) and sweeps expired files. D1 calls: 2.
 * R2: one put, and at most FILE_IMPORT_SWEEP deletes.
 */
export async function previewFile(
  env: Env,
  actor: string,
  input: PreviewInput,
): Promise<FileImportPreviewResult> {
  const now = planClock.now();
  const nowIso = now.toISOString();
  const db = getDb(env);
  const { budgetId, accountId, fileName, bytes } = input;
  if (bytes.length > MAX_FILE_BYTES) {
    throw new FileImportRefused(413, "file_too_large", "The file is larger than 2 MB");
  }
  const format = fileFormatOf(fileName);
  if (!format) {
    throw new FileImportRefused(422, "unsupported_format", "Use a CSV, TSV, OFX, QFX or QIF file");
  }

  const [accountRows, settingsRows, sbDate, reconciled, sweepable] = (await batch(db, [
    repo.accountForImportQuery(db, budgetId, accountId),
    repo.settingsQuery(db, accountId),
    accountsRepo.startingBalanceDateQuery(db, accountId),
    accountsRepo.latestReconciledDateQuery(db, accountId),
    repo.sweepableQuery(db, nowIso, FILE_IMPORT_SWEEP),
  ])) as [
    Awaited<ReturnType<typeof repo.accountForImportQuery>>,
    repo.SettingsRow[],
    { d: string | null }[],
    { d: string | null }[],
    repo.FileImportRow[],
  ];
  const account = accountRows[0];
  if (!account) throw new FileImportRefused(404, "not_found", "Account not found");
  if (account.closed) {
    throw new FileImportRefused(
      422,
      "account_closed",
      "This account is closed: it takes no new transactions",
    );
  }

  const remembered = rememberedOf(settingsRows.find((s) => s.format === format));
  const asked = Object.fromEntries(
    Object.entries(input.options ?? {}).filter(([, v]) => v !== undefined),
  );
  const read0 = readFile(fileName, bytes, {
    no_header: Boolean(asked.no_header ?? remembered.no_header ?? false),
  });
  const isCsv = "cells" in read0.parsed;
  const labelCount = isCsv ? ((read0.parsed as { cells: string[][] }).cells[0]?.length ?? 0) : 0;
  const mapping = remembered.mapping as Record<string, number | null> | null | undefined;
  if (mapping && Object.values(mapping).some((i) => i !== null && i >= labelCount)) {
    remembered.mapping = null;
  }
  const options = parseOptions({
    ...remembered,
    ...asked,
    today: asked.today ?? dayOf(nowIso),
  });
  const read =
    options.no_header === Boolean(asked.no_header ?? remembered.no_header ?? false)
      ? read0
      : readFile(fileName, bytes, options);

  const built = await buildFileRows(
    read.parsed,
    options,
    {
      today: options.today,
      cutoff: {
        start: sbDate[0]?.d ?? null,
        reconciled: reconciled[0]?.d ?? null,
        importStart: account.importStartDate,
      },
      accountId,
      planFormat: account.planFormat as never,
    },
    sha256Hex,
  );

  const fileId = crypto.randomUUID();
  const r2Key = keyOf(fileId, budgetId);
  const expiresAt = new Date(now.getTime() + FILE_IMPORT_KEEP_DAYS * DAY_MS).toISOString();
  await env.FILES.put(r2Key, bytes);
  const writes: unknown[] = [
    repo.insertFileStmt(db, {
      id: fileId,
      budgetId,
      accountId,
      actor,
      fileName,
      format,
      byteSize: bytes.length,
      r2Key,
      createdAt: nowIso,
      expiresAt,
      deletedAt: null,
    }),
  ];
  if (sweepable.length > 0) {
    writes.push(repo.sweepStmt(db, JSON.stringify(sweepable.map((s) => s.id)), nowIso));
  }
  await batch(db, writes);
  for (const s of sweepable) await env.FILES.delete(s.r2Key);

  const labels = isCsv
    ? columnLabels((read.parsed as { cells: string[][] }).cells[0] ?? [], options.no_header)
    : null;
  return {
    file_name: fileName,
    format,
    labels,
    mapping: labels ? (options.mapping ?? autoMap(labels)) : null,
    date_format: built.dateFormat,
    date_question: built.dateQuestion,
    rows: built.rows,
    skipped_before: built.skippedBefore,
    row_count: read.rowCount,
    file_id: fileId,
    options,
    expires_at: expiresAt,
  };
}

// ---------------------------------------------------------------------------------------------------- import

export interface ImportInput {
  budgetId: string;
  accountId: string;
  fileId: string;
  options: FileImportOptionsT;
}

type MergeRow = [
  id: string,
  updatedAt: string,
  before: unknown,
  after: unknown,
  importDate: string,
  importAmount: number,
  importMemo: string | null,
  cleared: string,
];
type CreateRow = [after: unknown, payeeId: string | null, importMemo: string | null];

/** Everything the single write batch needs, decided and serialised. */
export interface ImportPlan {
  ctx: repo.WriteCtx;
  newPayees: [id: string, name: string][];
  merges: MergeRow[];
  inserts: CreateRow[];
  sb: { row: TransactionRow; date: string; before: unknown; after: unknown } | null;
  settings: {
    format: repo.SettingsRow["format"];
    options: unknown;
    was: repo.SettingsRow | null;
  } | null;
  sweptIds: string[];
}

export interface PreparedImport {
  plan: ImportPlan;
  result: FileImportResult;
  sweptKeys: string[];
}

const forExisting = (n: importsRepo.CategoryNames, id: string | null) => {
  const c = id ? n.get(id) : undefined;
  return c
    ? { categoryName: c.name, groupName: c.groupName }
    : { categoryName: null, groupName: null };
};

const forNewRow = (n: importsRepo.CategoryNames, id: string | null) => {
  const c = id ? n.get(id) : undefined;
  return c && !c.deleted
    ? { categoryName: c.name, groupName: c.groupName }
    : { categoryName: null, groupName: null };
};

const defaultOf = (x: payeesRepo.PayeeListRow) => {
  const p = payeeToApi(x, x.lastCategoryId, x.lastInflowToReadyToAssign);
  return {
    categoryId: p.default_category_id,
    inflowToReadyToAssign: p.default_inflow_to_ready_to_assign,
  };
};

/** The reads and the decisions of an import, without writing anything. D1 calls: 3 (call 2 and 3 only for kept rows). */
export async function prepareImport(
  env: Env,
  actor: string,
  input: ImportInput,
): Promise<PreparedImport> {
  const now = planClock.now();
  const nowIso = now.toISOString();
  const db = getDb(env);
  const { budgetId, accountId, fileId } = input;
  const options = input.options;

  const [fileRows, accountRows, sbRows, reconciled, settingsRows, sweepable] = (await batch(db, [
    repo.fileRowQuery(db, fileId),
    repo.accountForImportQuery(db, budgetId, accountId),
    repo.startingBalanceRowQuery(db, accountId),
    accountsRepo.latestReconciledDateQuery(db, accountId),
    repo.settingsQuery(db, accountId),
    repo.sweepableQuery(db, nowIso, FILE_IMPORT_SWEEP),
  ])) as [
    repo.FileImportRow[],
    Awaited<ReturnType<typeof repo.accountForImportQuery>>,
    { t: TransactionRow }[],
    { d: string | null }[],
    repo.SettingsRow[],
    repo.FileImportRow[],
  ];
  const account = accountRows[0];
  const file = fileRows[0];
  if (!account || !file || file.budgetId !== budgetId || file.accountId !== accountId) {
    throw new FileImportRefused(404, "not_found", "Account or file not found");
  }
  const expired =
    new Date(nowIso).getTime() - new Date(file.createdAt).getTime() >
    FILE_IMPORT_KEEP_DAYS * DAY_MS;
  if (file.deletedAt || expired) {
    throw new FileImportRefused(
      410,
      "file_expired",
      "The file is no longer stored; upload it again",
    );
  }
  if (account.closed) {
    throw new FileImportRefused(
      422,
      "account_closed",
      "This account is closed: it takes no new transactions",
    );
  }
  const object = await env.FILES.get(file.r2Key);
  if (!object)
    throw new FileImportRefused(
      410,
      "file_expired",
      "The file is no longer stored; upload it again",
    );
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) {
    throw new FileImportRefused(413, "file_too_large", "The file is larger than 2 MB");
  }
  const read = readFile(file.fileName, bytes, options);
  const sb = sbRows[0]?.t ?? null;
  const built = await buildFileRows(
    read.parsed,
    options,
    {
      today: options.today,
      cutoff: {
        start: sb?.date ?? null,
        reconciled: reconciled[0]?.d ?? null,
        importStart: account.importStartDate,
      },
      accountId,
      planFormat: account.planFormat as never,
    },
    sha256Hex,
  );
  if (built.dateQuestion) {
    throw new FileImportRefused(
      422,
      "date_format_unclear",
      `Choose the date format of the file (it begins ${built.dateQuestion.first_value})`,
    );
  }

  const ctx: repo.WriteCtx = { budgetId, accountId, actor, now: nowIso };
  const kept = built.rows.filter(
    (r) => r.skip === null && r.key !== null && r.date !== null && r.amount !== null,
  ) as (FileImportRow & {
    key: string;
    date: string;
    amount: number;
  })[];
  let skipped = built.rows.length - kept.length;
  let matched = 0;
  let imported = 0;
  const plan: ImportPlan = {
    ctx,
    newPayees: [],
    merges: [],
    inserts: [],
    sb: null,
    settings: null,
    sweptIds: sweepable.map((s) => s.id),
  };

  if (kept.length > 0) {
    const dates = kept.map((r) => r.date);
    const lo = dates.reduce((a, b) => (a < b ? a : b));
    const hi = dates.reduce((a, b) => (a > b ? a : b));
    const from = minusDays(lo, MATCH_WINDOW_DAYS);
    const to = minusDays(hi, -MATCH_WINDOW_DAYS);
    const [knownRows, candRows, lineRows, directRows, ruleRows, nameRows] = (await batch(db, [
      repo.knownKeysQuery(db, budgetId, JSON.stringify(kept.map((r) => r.key))),
      importsRepo.matchCandidatesQuery(db, accountId, from, to),
      repo.candidateLinesQuery(db, accountId, from, to),
      repo.directRowsQuery(db, accountId, from, to),
      rulesRepo.rulesForPlanQuery(db, budgetId),
      importsRepo.categoryNamesQuery(db, budgetId),
    ])) as [
      { key: string }[],
      TransactionRow[],
      { t: TransactionRow; categoryName: string | null; groupName: string | null }[],
      { id: string; date: string; amount: number }[],
      { r: rulesRepo.RuleRow }[],
      Parameters<typeof importsRepo.toCategoryNames>[0],
    ];
    const payeeRows = await payeesRepo.listForPlan(db, budgetId, { includeHidden: true });

    const known = new Set(knownRows.map((r) => r.key));
    const candidates = candRows.map(importsRepo.toCandidate);
    const candidateById = new Map(candidates.map((c) => [c.id, c]));
    const candidateList = candidates.map((c) => ({
      id: c.id,
      date: c.date,
      amount: c.amount,
      createdAt: c.createdAt,
    }));
    const lines = lineRows.map(repo.toLineRow);
    const linesOf = (id: string): LineRow[] => lines.filter((l) => l.parentTransactionId === id);
    const rules = ruleRows.map((x) => x.r);
    const names = importsRepo.toCategoryNames(nameRows);
    const payeeById = new Map(payeeRows.map((p) => [p.id, p]));
    const kinds = {
      takesCategory: isOnBudget(account.type) && !isLoanType(account.type),
      rtaInflow: account.type === "checking" || account.type === "savings",
    };
    const used = new Set<string>();
    const directUsed = new Set<string>();
    const newIds = new Map<string, string>();
    let earliest: string | null = null;
    const touch = (d: string) => {
      if (earliest === null || d < earliest) earliest = d;
    };

    /** The row an import of `r` creates (or inserts as the fallback of a merge, which makes no new payee). */
    const createRow = (r: (typeof kept)[number], fallback: boolean): CreateRow => {
      const text = r.payee_text;
      const resolved = resolveImportedPayee(text, rules, payeeRows);
      let payeeId: string | null = null;
      let payeeName: string | null = null;
      let def: { categoryId: string | null; inflowToReadyToAssign: boolean } | null = null;
      if (resolved && "payee_id" in resolved) {
        const p = payeeById.get(resolved.payee_id);
        payeeId = resolved.payee_id;
        payeeName = p?.name ?? null;
        def = p ? defaultOf(p) : null;
      } else if (resolved) {
        payeeName = resolved.new_name;
        if (!fallback) {
          let id = newIds.get(resolved.new_name);
          if (!id) {
            id = crypto.randomUUID();
            newIds.set(resolved.new_name, id);
            plan.newPayees.push([id, resolved.new_name]);
          }
          payeeId = id;
        }
      }
      const cat = categoryFor(kinds, r.amount, def);
      const row: TransactionRow = {
        id: crypto.randomUUID(),
        budgetId,
        accountId,
        date: r.date,
        payeeId,
        payeeName,
        categoryId: cat.categoryId,
        inflowToReadyToAssign: cat.inflowToReadyToAssign,
        memo: r.memo,
        amount: r.amount,
        cleared: "cleared",
        approved: false,
        createdAt: nowIso,
        deletedAt: null,
        updatedAt: nowIso,
        importId: r.key,
        source: "file",
        importedPayee: text,
        bankDescription: null,
        importDate: r.date,
        importAmount: r.amount,
        importPayeeName: text || null,
        importMemo: r.memo,
      };
      const after = {
        ...logShape({ ...row, ...forNewRow(names, cat.categoryId) }),
        ...(resolved?.rule_id ? { rename_rule_id: resolved.rule_id } : {}),
      };
      return [after, payeeId, r.memo];
    };

    for (const r of kept) {
      if (known.has(r.key)) {
        matched++;
        continue;
      }
      const pick = pickMatch({ date: r.date, amount: r.amount }, candidateList, used);
      if (pick) {
        used.add(pick);
        const c = (candidateById.get(pick) as importsRepo.MatchCandidate).row;
        const cl = linesOf(c.id);
        const names2 = forExisting(names, c.categoryId);
        const cleared = c.cleared === "reconciled" ? "reconciled" : "cleared";
        const after: TransactionRow = {
          ...c,
          importId: r.key,
          importedPayee: r.payee_text,
          importDate: r.date,
          importAmount: r.amount,
          importPayeeName: r.payee_text || null,
          importMemo: r.memo,
          cleared,
          approved: true,
          updatedAt: nowIso,
        };
        plan.merges.push([
          c.id,
          c.updatedAt,
          logShape({ ...c, ...names2 }, cl),
          logShape({ ...after, ...names2 }, cl),
          r.date,
          r.amount,
          r.memo,
          cleared,
        ]);
        // The fallback of a match whose candidate changed meanwhile: it inserts nothing once the merge is written.
        plan.inserts.push(createRow(r, true));
        matched++;
        touch(c.date);
        continue;
      }
      const dup = directRows.find(
        (d) => !directUsed.has(d.id) && d.date === r.date && d.amount === r.amount,
      );
      if (dup) {
        directUsed.add(dup.id);
        skipped++;
        continue;
      }
      plan.inserts.push(createRow(r, false));
      imported++;
      touch(r.date);
    }

    if (options.include_before_start && sb && earliest !== null && (earliest as string) < sb.date) {
      const date = earliest as string;
      const n = forExisting(names, sb.categoryId);
      plan.sb = {
        row: sb,
        date,
        before: logShape({ ...sb, ...n }),
        after: logShape({ ...sb, date, updatedAt: nowIso, ...n }),
      };
    }
  }

  if (options.remember) {
    const picked = pickRemembered(options);
    const was = settingsRows.find((s) => s.format === file.format) ?? null;
    if (!was || was.optionsJson !== JSON.stringify(picked)) {
      plan.settings = { format: file.format, options: picked, was };
    }
  }
  return { plan, result: { imported, matched, skipped }, sweptKeys: sweepable.map((s) => s.r2Key) };
}

/**
 * The one write batch of an import, in order: payees and their log, the merges (log, lines, update), the inserts and
 * their log, the Starting Balance move, the remembered options, the sweep, and the payees' defaults. A statement whose
 * JSON array is empty is left out, and each array is split at 900 KB, so the count does not follow the row count.
 */
export function buildImportBatch(db: Db, plan: ImportPlan): BatchItem<"sqlite">[] {
  const c = plan.ctx;
  const out: unknown[] = [];
  const sets = <T>(rows: readonly T[], ...stmts: ((json: string) => unknown)[]) => {
    for (const part of splitByBytes(rows)) {
      const json = JSON.stringify(part);
      for (const s of stmts) out.push(s(json));
    }
  };
  // Each statement runs over all parts before the next one starts, so the order across statements holds.
  const each = <T>(rows: readonly T[], stmt: (json: string) => unknown) => sets(rows, stmt);
  each(plan.newPayees, (j) => repo.insertPayeesStmt(db, c, j));
  each(plan.newPayees, (j) => repo.payeeLogStmt(db, c, j));
  each(plan.merges, (j) => repo.mergeLogStmt(db, c, j));
  each(plan.merges, (j) => repo.mergeLinesStmt(db, c, j));
  each(plan.merges, (j) => repo.mergeUpdateStmt(db, c, j));
  each(plan.inserts, (j) => repo.insertRowsStmt(db, c, j));
  each(plan.inserts, (j) => repo.createLogStmt(db, c, j));
  if (plan.sb)
    out.push(...repo.startingBalanceMoveStmts(db, c, plan.sb.row, plan.sb.date, plan.sb));
  if (plan.settings) {
    const s = plan.settings;
    out.push(
      ...(s.was
        ? repo.settingsUpdateStmts(db, c, s.format, s.was, s.options)
        : repo.settingsCreateStmts(db, c, s.format, s.options)),
    );
  }
  if (plan.sweptIds.length > 0) out.push(repo.sweepStmt(db, JSON.stringify(plan.sweptIds), c.now));
  const defaults = recomputeDefaultsStmt(db, c.budgetId, "plan");
  if (defaults) out.push(defaults);
  return out as BatchItem<"sqlite">[];
}

export interface ImportRequest {
  budgetId: string;
  accountId: string;
  options: FileImportOptionsT;
  fileId?: string;
  /** MCP content: stored like a preview first, then imported. */
  file?: { fileName: string; bytes: Uint8Array };
}

/** Imports a stored file, in one atomic batch. D1 calls: 4 (6 with `file`). */
export async function importFile(
  env: Env,
  actor: string,
  req: ImportRequest,
): Promise<FileImportResult> {
  let fileId = req.fileId;
  if (req.file) {
    const stored = await previewFile(env, actor, {
      budgetId: req.budgetId,
      accountId: req.accountId,
      fileName: req.file.fileName,
      bytes: req.file.bytes,
      options: req.options,
    });
    fileId = stored.file_id;
  }
  if (!fileId)
    throw new FileImportRefused(
      422,
      "unprocessable_entity",
      "Give a file_id or the file's content",
    );
  const prepared = await prepareImport(env, actor, {
    budgetId: req.budgetId,
    accountId: req.accountId,
    fileId,
    options: req.options,
  });
  const db = getDb(env);
  const stmts = buildImportBatch(db, prepared.plan);
  await db.batch(stmts as unknown as Stmts);
  for (const key of prepared.sweptKeys) await env.FILES.delete(key);
  return prepared.result;
}
