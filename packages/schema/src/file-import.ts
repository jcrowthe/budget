/**
 * File import, the deciding half: the 13 date formats and their detection, CSV auto-mapping, file rows with import
 * keys and skip reasons, the caps, the Zod schemas and the copy (EXF-531). Pure: SHA-256 is injected, so the Worker
 * (crypto.subtle) and the browser give the same keys as the tests (node:crypto). Design: docs/file-import-design.md.
 */
import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { Milliunits } from "./common/money";
import { FILE_FORMATS, type ParsedFile } from "./file-import-read";
import { skipReason } from "./plaid-import";
import {
  DATE_FORMATS,
  type DateFormat,
  detectDecimal,
  parseAmount,
  parseDate,
} from "./plan-import-read";
import { foldRuleText } from "./rename-rules";
import { isCalendarDate } from "./transactions";

export const MAX_FILE_ROWS = 2000;
export const MAX_FILE_BYTES = 2_000_000;

// ---------------------------------------------------------------------------------------------------- dates

export const FILE_DATE_FORMATS = [
  DATE_FORMATS[0],
  "DD/MM/YYYY",
  "DD/MMM/YYYY",
  "DD/MMMM/YYYY",
  "YYYY/MM/DD",
  "YYYY/DD/MM",
  "MM-DD-YYYY",
  "DD-MM-YY",
  "DD-MM-YYYY",
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "YYYY.MM.DD",
  "MM/DD'YYYY",
] as const;
export const FileDateFormat = z.enum(FILE_DATE_FORMATS).openapi("FileDateFormat");
export type FileDateFormat = (typeof FILE_DATE_FORMATS)[number];

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

interface TokenParser {
  re: RegExp;
  tokens: string[];
}
const tokenParsers = new Map<string, TokenParser>();

function tokenParser(fmt: string): TokenParser {
  let p = tokenParsers.get(fmt);
  if (p) return p;
  const tokens: string[] = [];
  let source = "";
  for (const part of fmt.split(/(YYYY|YY|MMMM|MMM|MM|DD)/)) {
    if (part === "") continue;
    if (/^(YYYY|YY|MMMM|MMM|MM|DD)$/.test(part)) {
      tokens.push(part);
      source +=
        part === "YYYY"
          ? "(\\d{4})"
          : part === "YY"
            ? "(\\d{2})"
            : part === "MMMM" || part === "MMM"
              ? "([A-Za-z]+)"
              : "(\\d{1,2})";
    } else {
      source += part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  p = { re: new RegExp(`^${source}$`), tokens };
  tokenParsers.set(fmt, p);
  return p;
}

/** ISO for a date written in `fmt` (trimmed, English month names, a real calendar date in 1900-2199), else null. */
export function parseFileDate(text: string, fmt: FileDateFormat): string | null {
  if ((DATE_FORMATS as readonly string[]).includes(fmt)) return parseDate(text, fmt as DateFormat);
  const { re, tokens } = tokenParser(fmt);
  const m = re.exec(text.trim());
  if (!m) return null;
  let y = 0;
  let mo = 0;
  let d = 0;
  for (let i = 0; i < tokens.length; i++) {
    const v = m[i + 1] as string;
    switch (tokens[i]) {
      case "YYYY":
        y = Number(v);
        break;
      case "YY":
        y = 2000 + Number(v);
        break;
      case "MM":
        mo = Number(v);
        break;
      case "DD":
        d = Number(v);
        break;
      case "MMM": {
        const idx = MONTH_NAMES.findIndex((n) => n.slice(0, 3) === v.toLowerCase());
        if (idx < 0 || v.length !== 3) return null;
        mo = idx + 1;
        break;
      }
      case "MMMM": {
        const idx = MONTH_NAMES.indexOf(v.toLowerCase());
        if (idx < 0) return null;
        mo = idx + 1;
        break;
      }
    }
  }
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (y < 1900 || y > 2199 || !isCalendarDate(iso)) return null;
  return iso;
}

/** A QIF `M/D'YY` is read as `M/D'20YY`, so `'YY` and `'YYYY` both land on `MM/DD'YYYY`. */
export function qifDateText(raw: string): string {
  return raw.replace(
    /^(\d{1,2})\/(\d{1,2})'(\d{2})$/,
    (_, m: string, d: string, y: string) => `${m}/${d}'20${y}`,
  );
}

export const FileImportDateQuestion = z
  .object({ first_value: z.string(), formats: z.array(FileDateFormat) })
  .openapi("FileImportDateQuestion");
export type FileImportDateQuestion = z.infer<typeof FileImportDateQuestion>;

/**
 * 1. every cell parses with the plan's format; 2. exactly one of the 13 parses every cell; 3. a question.
 * Blank cells are left out; with none left the plan's format is used.
 */
export function detectDateFormat(
  texts: readonly string[],
  planFormat: DateFormat | FileDateFormat,
): { format: FileDateFormat | null; question: FileImportDateQuestion | null } {
  const cells = texts.map((t) => t.trim()).filter((t) => t !== "");
  const plan = planFormat as FileDateFormat;
  const first = cells[0];
  if (first === undefined) return { format: plan, question: null };
  const unique = [...new Set(cells)];
  const all = (f: FileDateFormat) => unique.every((t) => parseFileDate(t, f) !== null);
  if (all(plan)) return { format: plan, question: null };
  const fits = FILE_DATE_FORMATS.filter(all);
  if (fits.length === 1) return { format: fits[0] as FileDateFormat, question: null };
  return { format: null, question: { first_value: first, formats: [...FILE_DATE_FORMATS] } };
}

// ---------------------------------------------------------------------------------------------------- mapping

export const CSV_FIELD_LABELS = {
  date: "Date",
  payee: "Payee",
  memo: "Memo",
  outflow: "Outflow",
  inflow: "Inflow",
} as const;
export type CsvField = keyof typeof CSV_FIELD_LABELS;
const CSV_FIELDS = Object.keys(CSV_FIELD_LABELS) as CsvField[];

const column = z.number().int().min(0).nullable();
export const FileImportMapping = z
  .object({ date: column, payee: column, memo: column, outflow: column, inflow: column })
  .openapi("FileImportMapping");
export type FileImportMapping = z.infer<typeof FileImportMapping>;

function letters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** The trimmed header cells, or `A, B, … Z, AA, …` with "No header row". */
export function columnLabels(firstRow: readonly string[], noHeader: boolean): string[] {
  return noHeader ? firstRow.map((_, i) => letters(i)) : firstRow.map((c) => c.trim());
}

/** For each field, the first column whose label equals the field's label (case-insensitive, trimmed). */
export function autoMap(labels: readonly string[]): FileImportMapping {
  const folded = labels.map((l) => l.trim().toLowerCase());
  const find = (f: CsvField) => {
    const i = folded.indexOf(CSV_FIELD_LABELS[f].toLowerCase());
    return i < 0 ? null : i;
  };
  return Object.fromEntries(CSV_FIELDS.map((f) => [f, find(f)])) as FileImportMapping;
}

// ---------------------------------------------------------------------------------------------------- schemas

export const FileImportOptions = z
  .object({
    no_header: z.boolean().default(false),
    mapping: FileImportMapping.nullable().default(null),
    date_format: FileDateFormat.nullable().default(null),
    swap_inflow_outflow: z.boolean().default(false),
    import_memos: z.boolean().default(true),
    swap_payee_memo: z.boolean().default(false),
    include_before_start: z.boolean().default(false),
    remember: z.boolean().default(true),
    today: IsoDate,
  })
  .openapi("FileImportOptions");
export type FileImportOptions = z.infer<typeof FileImportOptions>;

export const FILE_ROW_SKIPS = [
  "before_start",
  "before_reconciled",
  "invalid",
  "duplicate_in_file",
] as const;

export const FileImportRow = z
  .object({
    date: IsoDate.nullable(),
    payee_text: z.string(),
    memo: z.string().nullable(),
    amount: Milliunits.nullable(),
    fitid: z.string().nullable(),
    line: z.number().int().min(1),
    key: z.string().nullable(),
    skip: z.enum(FILE_ROW_SKIPS).nullable(),
  })
  .openapi("FileImportRow");
export type FileImportRow = z.infer<typeof FileImportRow>;

export const FileImportPreview = z
  .object({
    file_name: z.string(),
    format: z.enum(FILE_FORMATS),
    labels: z.array(z.string()).nullable(),
    mapping: FileImportMapping.nullable(),
    date_format: FileDateFormat.nullable(),
    date_question: FileImportDateQuestion.nullable(),
    rows: z.array(FileImportRow),
    skipped_before: z.number().int().min(0),
    row_count: z.number().int().min(0),
  })
  .openapi("FileImportPreview");
export type FileImportPreview = z.infer<typeof FileImportPreview>;

export const FileImportResult = z
  .object({
    imported: z.number().int().min(0),
    matched: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .openapi("FileImportResult");
export type FileImportResult = z.infer<typeof FileImportResult>;

// ---------------------------------------------------------------------------------------------------- rows

export interface FileImportContext {
  today: string;
  cutoff: { start: string | null; reconciled: string | null; importStart: string | null };
  accountId: string;
  planFormat: DateFormat | FileDateFormat;
}

interface Source {
  line: number;
  dateText: string;
  /** OFX rows carry the date already read. */
  isoDate: string | null;
  payee: string;
  memo: string | null;
  amount: number | null;
  fitid: string | null;
}

const trimmedOrNull = (s: string | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

function csvSources(
  cells: readonly string[][],
  options: FileImportOptions,
): { sources: Source[]; mapping: FileImportMapping } {
  const mapping = options.mapping ?? autoMap(columnLabels(cells[0] ?? [], options.no_header));
  const data = options.no_header ? cells : cells.slice(1);
  const firstLine = options.no_header ? 1 : 2;
  const cell = (row: readonly string[], i: number | null): string =>
    i === null ? "" : (row[i] ?? "").trim();

  let decimal: string | null = null;
  for (const row of data) {
    for (const i of new Set([mapping.outflow, mapping.inflow])) {
      const d = detectDecimal(cell(row, i));
      if (d !== null) {
        decimal = d;
        break;
      }
    }
    if (decimal !== null) break;
  }
  const read = (text: string): number | null => parseAmount(text, decimal)?.milliunits ?? null;
  const signed = mapping.outflow !== null && mapping.outflow === mapping.inflow;

  const sources = data.map((row, i): Source => {
    let amount: number | null;
    if (signed) {
      const text = cell(row, mapping.outflow);
      amount = text === "" ? null : read(text);
    } else {
      const o = cell(row, mapping.outflow);
      const n = cell(row, mapping.inflow);
      const ov = o === "" ? 0 : read(o);
      const nv = n === "" ? 0 : read(n);
      amount =
        (o === "" && n === "") || ov === null || nv === null ? null : Math.abs(nv) - Math.abs(ov);
    }
    return {
      line: firstLine + i,
      dateText: cell(row, mapping.date),
      isoDate: null,
      payee: cell(row, mapping.payee),
      memo: trimmedOrNull(cell(row, mapping.memo)),
      amount,
      fitid: null,
    };
  });
  return { sources, mapping };
}

const negate = (n: number): number => (n === 0 ? 0 : -n);

/**
 * File rows from a parsed file: fields, swaps, date format, keys, duplicates, the future clamp and the cutoff, in
 * the order of the design. `hash(text)` is the lower-case hex SHA-256 of the text's UTF-8.
 */
export async function buildFileRows(
  parsed: ParsedFile,
  options: FileImportOptions,
  ctx: FileImportContext,
  hash: (text: string) => Promise<string>,
): Promise<{
  rows: FileImportRow[];
  skippedBefore: number;
  dateQuestion: FileImportDateQuestion | null;
  dateFormat: FileDateFormat | null;
}> {
  const isCsv = parsed.format === "csv" || parsed.format === "tsv";
  let sources: Source[];
  if ("cells" in parsed) {
    sources = csvSources(parsed.cells, options).sources;
  } else if (parsed.format === "qif") {
    sources = parsed.entries.map((e, i) => ({
      line: i + 1,
      dateText: qifDateText(e.dateText),
      isoDate: null,
      payee: e.payee ?? "",
      memo: e.memo,
      amount: e.amount,
      fitid: null,
    }));
  } else {
    sources = parsed.entries.map((e, i) => ({
      line: i + 1,
      dateText: "",
      isoDate: e.date,
      payee: e.name ?? "",
      memo: e.memo,
      amount: e.amount,
      fitid: e.fitid,
    }));
  }
  const isOfx = parsed.format === "ofx" || parsed.format === "qfx";

  // Step 3: Swap Payee and Memo (not CSV).
  if (!isCsv && options.swap_payee_memo) {
    for (const s of sources) {
      const memo = s.memo;
      s.memo = s.payee === "" ? null : s.payee;
      s.payee = memo ?? "";
    }
  }

  // Step 4: the date format.
  let dateFormat: FileDateFormat | null = null;
  let dateQuestion: FileImportDateQuestion | null = null;
  if (!isOfx) {
    if (options.date_format) dateFormat = options.date_format;
    else {
      const d = detectDateFormat(
        sources.map((s) => s.dateText),
        ctx.planFormat,
      );
      dateFormat = d.format;
      dateQuestion = d.question;
    }
  }

  if (dateQuestion) {
    const rows = sources.map(
      (s): FileImportRow => ({
        date: null,
        payee_text: s.payee,
        memo: !isCsv && !options.import_memos ? null : s.memo,
        amount:
          s.amount === null ? null : options.swap_inflow_outflow ? negate(s.amount) : s.amount,
        fitid: s.fitid,
        line: s.line,
        key: null,
        skip: null,
      }),
    );
    return { rows, skippedBefore: 0, dateQuestion, dateFormat: null };
  }

  const hashes = new Map<string, string>();
  const hashOf = async (payee: string, memo: string | null): Promise<string> => {
    const text = `${foldRuleText(payee)}\u0000${foldRuleText(memo ?? "")}`;
    let h = hashes.get(text);
    if (h === undefined) {
      h = (await hash(text)).slice(0, 16);
      hashes.set(text, h);
    }
    return h;
  };

  const occurrences = new Map<string, number>();
  const seenFitid = new Set<string>();
  const rows: FileImportRow[] = [];
  let skippedBefore = 0;

  for (const s of sources) {
    const fileDate = isOfx
      ? s.isoDate
      : dateFormat === null
        ? null
        : parseFileDate(s.dateText, dateFormat);
    const memoOut = !isCsv && !options.import_memos ? null : s.memo;
    if (fileDate === null || s.amount === null) {
      rows.push({
        date: fileDate,
        payee_text: s.payee,
        memo: memoOut,
        amount:
          s.amount === null ? null : options.swap_inflow_outflow ? negate(s.amount) : s.amount,
        fitid: s.fitid,
        line: s.line,
        key: null,
        skip: "invalid",
      });
      continue;
    }
    const amount = options.swap_inflow_outflow ? negate(s.amount) : s.amount;

    let key: string;
    let duplicate = false;
    if (isOfx && s.fitid !== null) {
      key = `file:v1:${ctx.accountId}:fitid:${s.fitid}`;
      if (seenFitid.has(key)) duplicate = true;
      seenFitid.add(key);
    } else {
      const h = await hashOf(s.payee, s.memo);
      const slot = `${fileDate}:${amount}:${h}`;
      const n = (occurrences.get(slot) ?? 0) + 1;
      occurrences.set(slot, n);
      key = `file:v1:${ctx.accountId}:${slot}:${n}`;
    }

    let date = fileDate;
    if (date > ctx.today) date = ctx.today;
    let skip: FileImportRow["skip"] = duplicate ? "duplicate_in_file" : null;
    if (!duplicate) {
      const reason = skipReason(
        { date },
        {
          closed: false,
          importStartDate: ctx.cutoff.importStart,
          startingBalanceDate: ctx.cutoff.start,
          latestReconciledDate: ctx.cutoff.reconciled,
        },
        false,
      );
      if (reason === "before_start" || reason === "before_reconciled") {
        skippedBefore++;
        if (!options.include_before_start) skip = reason;
      }
    }
    rows.push({
      date,
      payee_text: s.payee,
      memo: memoOut,
      amount,
      fitid: s.fitid,
      line: s.line,
      key,
      skip,
    });
  }
  return { rows, skippedBefore, dateQuestion: null, dateFormat };
}

// ---------------------------------------------------------------------------------------------------- copy

const noun = (n: number) => (n === 1 ? "transaction" : "transactions");

/** The EXF-531 strings, with "the field" for the source app's field. */
export const FILE_IMPORT_COPY = {
  toolbar: "File Import",
  tooltip: "Import transactions from a bank file.",
  intro:
    "To import transactions without linking your financial institution, first download a set of transactions from your bank or credit card website.",
  recommended: "Recommended formats: OFX, QFX, and CSV",
  supported: "Supported formats: QIF",
  duplicates:
    "Worried about duplicates? Transactions entered by you will match automatically. Direct Import duplicates are skipped.",
  dontShowAgain: "Don't show again",
  learnMore: "Learn More",
  chooseFile: "Choose File",
  accept: ".csv,.tsv,.ofx,.qfx,.qif",
  title: "Import Transactions",
  header: (n: number, file: string) =>
    `${n} ${n === 1 ? "Transaction" : "Transactions"} from ${file} will be imported into`,
  mappingHelp: "Choose the CSV column to match the field.",
  selectLabels: {
    date: "Date",
    payee: "Payee",
    memo: "Memo (optional)",
    outflow: "Outflow",
    inflow: "Inflow",
  },
  noHeaderRow: "No header row",
  swapInflowOutflow: "Swap Inflow and Outflow",
  remember: "Remember setting for this account",
  importMemos: "Import Memos",
  swapPayeeMemo: "Swap Payee and Memo",
  preview: "Preview",
  columns: { date: "DATE", payee: "PAYEE", memo: "MEMO", outflow: "OUTFLOW", inflow: "INFLOW" },
  unclearDate: (file: string, value: string) =>
    `The date format of ${file} is unclear. The first transaction reads ${value}. What date is this?`,
  save: "Save",
  willSkip: (n: number) => `${n} ${noun(n)} will be skipped`,
  skipExplanation:
    "This file has transactions dated before the account's start date or last reconciliation. Importing them will modify the start date for this account.",
  include: (n: number) =>
    `Include ${n} ${noun(n)} dated before account start date or last reconciliation`,
  cancel: "Cancel",
  import: "Import",
  successTitle: "Import Successful",
  matchedTitle: "Import Matched",
  successMessage: (imported: number, matched: number) => {
    const done = `${imported} ${noun(imported)} ${imported === 1 ? "has" : "have"} been successfully imported.`;
    if (matched === 0) return done;
    return `${done} ${matched} previously imported ${noun(matched)} ${matched === 1 ? "has" : "have"} been matched.`;
  },
  matchedMessage: (imported: number) =>
    `${imported} ${noun(imported)} ${imported === 1 ? "has" : "have"} been successfully imported. All transactions were matched to already entered or imported transactions, so there's nothing else for you to do!`,
  ok: "OK",
} as const;
