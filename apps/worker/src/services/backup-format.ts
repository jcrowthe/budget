// The codec of the nightly backup (docs/backup-design.md, "Format"): row encoding, gzip, sha256, page SQL.
// Plain web APIs only, so the restore test can import this under Node.
import type { BackupColumn, BackupTable } from "@budget/schema/backup";

export const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** A page: rows after `rowid > ?`, one more than `limit` is asked for by the caller (to know a table is done). */
export function pageSql(t: BackupTable): string {
  const cols = t.columns.map((c) => q(c.name)).join(", ");
  return `select rowid as "__rowid", ${cols} from ${q(t.name)} where rowid > ? order by rowid limit ?`;
}

export function isRowidAlias(cols: BackupColumn[]): string | null {
  const pks = cols.filter((c) => c.pk > 0);
  return pks.length === 1 && pks[0]?.type.toUpperCase() === "INTEGER" ? pks[0].name : null;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** null, number and string as they are; a BLOB (D1 returns number[]) as {"b64"}. */
export function encodeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return { b64: b64(Uint8Array.from(v as number[])) };
  if (v instanceof ArrayBuffer) return { b64: b64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v))
    return { b64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  return v;
}

/** One NDJSON line: [tableIndex, rowid, v1, …]; for a rowid-alias table the alias stays in place and rowid is left out. */
export function rowLine(index: number, t: BackupTable, row: Record<string, unknown>): string {
  const vals = t.columns.map((c) => encodeValue(row[c.name]));
  return JSON.stringify(t.rowid_alias ? [index, ...vals] : [index, row.__rowid, ...vals]);
}

export async function gzip(text: string): Promise<ArrayBuffer> {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(s).arrayBuffer();
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
