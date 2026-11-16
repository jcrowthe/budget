/**
 * A store-only ZIP writer (no compression, no ZIP64) and a reader of stored and deflated entries (EXF-477).
 * Pure; for the Reflect exports, Export Plan and Import Plan.
 */

let table: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (table[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** UTF-8 bytes of a string (no TextEncoder: this package is typed without DOM or Node). */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return Uint8Array.from(out);
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

/** MS-DOS date of a YYYY-MM-DD (years 1980–2107). */
function dosDate(date: string): number {
  const y = Math.min(2107, Math.max(1980, Number(date.slice(0, 4))));
  return ((y - 1980) << 9) | (Number(date.slice(5, 7)) << 5) | Number(date.slice(8, 10));
}

/** `time` is HH:mm (seconds are not written); omitted, the MS-DOS time field stays 0. */
export function storeZip(files: ZipFile[], date: string, time?: string): Uint8Array {
  if (files.length > 0xffff) throw new Error("Too many files for a ZIP without ZIP64");
  const day = dosDate(date);
  const clock =
    time === undefined ? 0 : (Number(time.slice(0, 2)) << 11) | (Number(time.slice(3, 5)) << 5);
  const entries = files.map((f) => ({
    name: utf8(f.name),
    data: f.data,
    crc: crc32(f.data),
  }));
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  if (size > 0xffffffff) throw new Error("Archive too large for a ZIP without ZIP64");
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let p = 0;
  const u16 = (n: number) => {
    v.setUint16(p, n, true);
    p += 2;
  };
  const u32 = (n: number) => {
    v.setUint32(p, n, true);
    p += 4;
  };
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(p);
    u32(0x04034b50);
    u16(20); // version needed
    u16(0x0800); // UTF-8 names
    u16(0); // stored
    u16(clock); // time
    u16(day);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0);
    out.set(e.name, p);
    p += e.name.length;
    out.set(e.data, p);
    p += e.data.length;
  }
  const centralStart = p;
  for (const [i, e] of entries.entries()) {
    u32(0x02014b50);
    u16(20); // version made by
    u16(20);
    u16(0x0800);
    u16(0);
    u16(clock); // time
    u16(day);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i] as number);
    out.set(e.name, p);
    p += e.name.length;
  }
  const centralSize = p - centralStart;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(centralSize);
  u32(centralStart);
  u16(0);
  return out;
}

// ---- Reader ----

export const ZIP_READ_LIMITS = { maxEntries: 8, maxEntryBytes: 32 * 1024 * 1024 };

export type ZipErrorCode =
  | "zip_corrupt"
  | "zip_encrypted"
  | "zip64"
  | "zip_method"
  | "zip_too_many_entries"
  | "zip_entry_too_large"
  | "zip_crc";

export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

const ZIP_TEXT = {
  corrupt: "The file is not a readable ZIP",
  encrypted: "This ZIP is encrypted; export the plan again without a password",
  zip64: "ZIP64 archives are not supported",
  method: "Only stored or deflated ZIP entries can be read",
  entries: (n: number) => `The ZIP has more than ${n} entries`,
  large: (n: number) => `A file in the ZIP is larger than ${Math.round(n / (1024 * 1024))} MiB`,
  crc: "A file in the ZIP is damaged (CRC mismatch)",
};

/** "PK\x03\x04" (a local header) or "PK\x05\x06" (an empty archive). */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
  );
}

/** Strict-enough UTF-8 decoding (no TextDecoder type in this package); bad sequences become U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let units: number[] = [];
  const flush = () => {
    parts.push(String.fromCharCode(...units));
    units = [];
  };
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] as number;
    let cp = 0xfffd;
    let len = 1;
    if (b < 0x80) cp = b;
    else if (
      b >= 0xc2 &&
      b < 0xe0 &&
      i + 1 < bytes.length &&
      ((bytes[i + 1] as number) & 0xc0) === 0x80
    ) {
      cp = ((b & 31) << 6) | ((bytes[i + 1] as number) & 63);
      len = 2;
    } else if (
      b >= 0xe0 &&
      b < 0xf0 &&
      i + 2 < bytes.length &&
      ((bytes[i + 1] as number) & 0xc0) === 0x80 &&
      ((bytes[i + 2] as number) & 0xc0) === 0x80
    ) {
      cp =
        ((b & 15) << 12) | (((bytes[i + 1] as number) & 63) << 6) | ((bytes[i + 2] as number) & 63);
      len = 3;
    } else if (
      b >= 0xf0 &&
      b < 0xf5 &&
      i + 3 < bytes.length &&
      ((bytes[i + 1] as number) & 0xc0) === 0x80 &&
      ((bytes[i + 2] as number) & 0xc0) === 0x80 &&
      ((bytes[i + 3] as number) & 0xc0) === 0x80
    ) {
      cp =
        ((b & 7) << 18) |
        (((bytes[i + 1] as number) & 63) << 12) |
        (((bytes[i + 2] as number) & 63) << 6) |
        ((bytes[i + 3] as number) & 63);
      len = 4;
    }
    if (cp > 0xffff) {
      cp -= 0x10000;
      units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else units.push(cp);
    i += len;
    if (units.length > 4096) flush();
  }
  flush();
  return parts.join("");
}

/**
 * Reads the entries of a ZIP: the central directory, stored and deflated data, CRC and size checks.
 * `inflateRaw(data, size)` inflates a raw deflate stream whose entry has `size` bytes (the Worker passes
 * DecompressionStream; this package has no DOM types). Refuses what it does not read with a ZipError.
 */
export async function unzip(
  bytes: Uint8Array,
  inflateRaw: (data: Uint8Array, size: number) => Promise<Uint8Array>,
  limits: Partial<typeof ZIP_READ_LIMITS> = {},
): Promise<ZipFile[]> {
  const { maxEntries, maxEntryBytes } = { ...ZIP_READ_LIMITS, ...limits };
  const corrupt = () => new ZipError("zip_corrupt", ZIP_TEXT.corrupt);
  if (bytes.length < 22) throw corrupt();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 65535); p--) {
    if (v.getUint32(p, true) === 0x06054b50) {
      end = p;
      break;
    }
  }
  if (end < 0) throw corrupt();
  if (end >= 20 && v.getUint32(end - 20, true) === 0x07064b50) {
    throw new ZipError("zip64", ZIP_TEXT.zip64);
  }
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  const cdStart = v.getUint32(end + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff) {
    throw new ZipError("zip64", ZIP_TEXT.zip64);
  }
  if (count > maxEntries) throw new ZipError("zip_too_many_entries", ZIP_TEXT.entries(maxEntries));
  if (cdStart + cdSize > end) throw corrupt();

  interface Central {
    name: string;
    method: number;
    crc: number;
    csize: number;
    size: number;
    offset: number;
  }
  const central: Central[] = [];
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50) throw corrupt();
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    if (p + 46 + nameLen > end) throw corrupt();
    const name = utf8Decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (csize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) {
      throw new ZipError("zip64", ZIP_TEXT.zip64);
    }
    if (name.endsWith("/") || name.startsWith("__MACOSX/")) continue;
    if (flags & 1) throw new ZipError("zip_encrypted", ZIP_TEXT.encrypted);
    if (method !== 0 && method !== 8) throw new ZipError("zip_method", ZIP_TEXT.method);
    if (size > maxEntryBytes)
      throw new ZipError("zip_entry_too_large", ZIP_TEXT.large(maxEntryBytes));
    central.push({ name, method, crc, csize, size, offset });
  }

  const out: ZipFile[] = [];
  for (const e of central) {
    if (e.offset + 30 > bytes.length || v.getUint32(e.offset, true) !== 0x04034b50) throw corrupt();
    const start =
      e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
    if (start + e.csize > bytes.length) throw corrupt();
    const raw = bytes.subarray(start, start + e.csize);
    let data: Uint8Array;
    if (e.method === 0) {
      if (e.csize !== e.size) throw new ZipError("zip_crc", ZIP_TEXT.crc);
      data = raw;
    } else {
      data = await inflateRaw(raw, e.size);
      if (data.length !== e.size) throw new ZipError("zip_crc", ZIP_TEXT.crc);
    }
    if (crc32(data) !== e.crc) throw new ZipError("zip_crc", ZIP_TEXT.crc);
    out.push({ name: e.name, data });
  }
  return out;
}
