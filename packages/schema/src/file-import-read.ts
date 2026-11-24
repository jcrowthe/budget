/**
 * File import, the reading half: file formats, text decoding, CSV/TSV, OFX/QFX and QIF readers. Pure, no DOM or
 * Node types: readers take a string, and the decoder is injected. Design: docs/file-import-design.md.
 */
import {
  detectDecimal,
  ImportError,
  parseAmount,
  readDelimited,
  stripBom,
} from "./plan-import-read";
import { isCalendarDate } from "./transactions";

export const FILE_FORMATS = ["csv", "tsv", "ofx", "qfx", "qif"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

/** The text after the last `.`, lower-cased, when it is one of the five formats. */
export function fileFormatOf(fileName: string): FileFormat | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return (FILE_FORMATS as readonly string[]).includes(ext) ? (ext as FileFormat) : null;
}

export type FileImportErrorCode = "unreadable" | "no_rows" | "unsupported_format";

/** The file cannot be read; the API answers 422 with this code. */
export class FileImportError extends Error {
  constructor(
    readonly code: FileImportErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FileImportError";
  }
}

export type FileDecoder = (bytes: Uint8Array, label: "utf-8" | "windows-1252") => string;

/**
 * Bytes to text with an injected decoder (`(b, l) => new TextDecoder(l).decode(b)`). A UTF-8 BOM means utf-8; a
 * declared 1252 (OFX `CHARSET:1252`, XML `encoding="windows-1252"`) means windows-1252; otherwise utf-8, and bad
 * UTF-8 (U+FFFD the bytes did not hold) is read again as windows-1252.
 */
export function decodeFileText(bytes: Uint8Array, decoder: FileDecoder): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return stripBom(decoder(bytes, "utf-8"));
  }
  let head = "";
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i < n; i++) head += String.fromCharCode((bytes[i] as number) & 0x7f);
  if (
    /CHARSET:\s*1252/i.test(head) ||
    /encoding\s*=\s*["'](?:windows-1252|iso-8859-1|latin1)["']/i.test(head)
  ) {
    return stripBom(decoder(bytes, "windows-1252"));
  }
  const text = decoder(bytes, "utf-8");
  if (text.includes("�") && !hasReplacementBytes(bytes)) {
    return stripBom(decoder(bytes, "windows-1252"));
  }
  return stripBom(text);
}

function hasReplacementBytes(bytes: Uint8Array): boolean {
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0xef && bytes[i + 1] === 0xbf && bytes[i + 2] === 0xbd) return true;
  }
  return false;
}

export function readCsv(text: string, delimiter: "," | "\t"): { cells: string[][] } {
  let cells: string[][];
  try {
    cells = readDelimited(stripBom(text), delimiter);
  } catch (e) {
    if (e instanceof ImportError) throw new FileImportError("unreadable", e.message);
    throw e;
  }
  if (cells.length === 0) throw new FileImportError("no_rows", "The file has no rows");
  return { cells };
}

export interface OfxEntry {
  date: string | null;
  amount: number | null;
  fitid: string | null;
  name: string | null;
  memo: string | null;
}

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith("#x")) return safeCodePoint(Number.parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith("#")) return safeCodePoint(Number.parseInt(lower.slice(1), 10), whole);
    return NAMED[lower] ?? whole;
  });
}

function safeCodePoint(cp: number, fallback: string): string {
  return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : fallback;
}

/** `<TAG>value` up to the next `<` or line end. */
function leaf(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag.replace(".", "\\.")}>([^<\\r\\n]*)`, "i").exec(block);
  if (!m) return null;
  const v = decodeEntities(m[1] as string).trim();
  return v === "" ? null : v;
}

function amountOf(text: string): number | null {
  const p = parseAmount(text, detectDecimal(text));
  return p ? p.milliunits : null;
}

export function readOfx(text: string): { entries: OfxEntry[] } {
  if (!/<OFX[\s>]/i.test(text)) throw new FileImportError("unreadable", "The file is not OFX");
  const entries: OfxEntry[] = [];
  const starts = [...text.matchAll(/<STMTTRN>/gi)].map((m) => m.index as number);
  for (const start of starts) {
    const body = start + "<STMTTRN>".length;
    const rest = text.slice(body);
    const end = /<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>/i.exec(rest);
    const block = end ? rest.slice(0, end.index) : rest;
    const payee = /<PAYEE>([\s\S]*?)<\/PAYEE>/i.exec(block);
    const outside = block.replace(/<PAYEE>[\s\S]*?<\/PAYEE>/gi, "");
    const posted = leaf(block, "DTPOSTED");
    const day = posted ? /^\d{8}/.exec(posted)?.[0] : undefined;
    const iso = day ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` : null;
    const amt = leaf(block, "TRNAMT");
    entries.push({
      date: iso !== null && isCalendarDate(iso) ? iso : null,
      amount: amt === null ? null : amountOf(amt),
      fitid: leaf(block, "FITID"),
      name: leaf(outside, "NAME") ?? (payee ? leaf(payee[1] as string, "NAME") : null),
      memo: leaf(block, "MEMO"),
    });
  }
  if (entries.length === 0) throw new FileImportError("no_rows", "The file has no transactions");
  return { entries };
}

export interface QifEntry {
  dateText: string;
  amount: number | null;
  payee: string | null;
  memo: string | null;
}

const QIF_TYPES = ["bank", "ccard", "cash", "oth a", "oth l"];

export function readQif(text: string): { entries: QifEntry[] } {
  interface Rec {
    d: string;
    t: string | null;
    u: string | null;
    p: string | null;
    m: string | null;
  }
  const blank = (): Rec => ({ d: "", t: null, u: null, p: null, m: null });
  const records: Rec[] = [];
  let cur: Rec | null = null;
  let typed = false;
  let inAccount = false;
  const flush = () => {
    if (cur) records.push(cur);
    cur = null;
  };
  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    if (line.startsWith("!")) {
      const lower = line.toLowerCase();
      if (lower.startsWith("!type:")) {
        flush();
        if (!typed) {
          if (!QIF_TYPES.includes(lower.slice(6).trim()))
            throw new FileImportError("unsupported_format", "This QIF type is not supported");
          typed = true;
        }
        inAccount = false;
      } else if (lower.startsWith("!account")) {
        flush();
        inAccount = true;
      }
      continue;
    }
    if (!typed) {
      if (inAccount) {
        if (line === "^") inAccount = false;
        continue;
      }
      throw new FileImportError("unreadable", "The file is not QIF");
    }
    if (inAccount) {
      if (line === "^") inAccount = false;
      continue;
    }
    if (line.startsWith("^")) {
      flush();
      continue;
    }
    const rec: Rec = cur ?? blank();
    cur = rec;
    const value = line.slice(1);
    switch (line[0]) {
      case "D":
        rec.d = value.replace(/\s+/g, "");
        break;
      case "T":
        rec.t = value.trim();
        break;
      case "U":
        rec.u = value.trim();
        break;
      case "P":
        rec.p = value.trim() === "" ? null : value.trim();
        break;
      case "M":
        rec.m = value.trim() === "" ? null : value.trim();
        break;
      default:
        break;
    }
  }
  flush();
  if (!typed) throw new FileImportError("unreadable", "The file is not QIF");
  if (records.length === 0) throw new FileImportError("no_rows", "The file has no transactions");
  const texts = records.map((r) => r.t ?? r.u).filter((s): s is string => s !== null && s !== "");
  let decimal: string | null = null;
  for (const t of texts) {
    decimal = detectDecimal(t);
    if (decimal !== null) break;
  }
  const entries = records.map((r): QifEntry => {
    const a = r.t ?? r.u;
    const parsed = a === null || a === "" ? null : parseAmount(a, decimal);
    return { dateText: r.d, amount: parsed ? parsed.milliunits : null, payee: r.p, memo: r.m };
  });
  return { entries };
}

export type ParsedFile =
  | { format: "csv" | "tsv"; cells: string[][] }
  | { format: "ofx" | "qfx"; entries: OfxEntry[] }
  | { format: "qif"; entries: QifEntry[] };

export function readFileText(fileName: string, text: string): ParsedFile {
  const format = fileFormatOf(fileName);
  switch (format) {
    case "csv":
      return { format, ...readCsv(text, ",") };
    case "tsv":
      return { format, ...readCsv(text, "\t") };
    case "ofx":
    case "qfx":
      return { format, ...readOfx(text) };
    case "qif":
      return { format, ...readQif(text) };
    default:
      throw new FileImportError("unsupported_format", "Use a CSV, TSV, OFX, QFX or QIF file");
  }
}
