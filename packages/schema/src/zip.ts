/** A store-only ZIP writer (no compression, no ZIP64). Pure; for the Reflect exports. */

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
  for (const b of bytes) crc = (table[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
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

/** MS-DOS time of an HH:mm (seconds are always 0). */
function dosTime(time: string): number {
  return (Number(time.slice(0, 2)) << 11) | (Number(time.slice(3, 5)) << 5);
}

export function storeZip(files: ZipFile[], date: string, time = "00:00"): Uint8Array {
  if (files.length > 0xffff) throw new Error("Too many files for a ZIP without ZIP64");
  const day = dosDate(date);
  const clock = dosTime(time);
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
    u16(clock);
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
