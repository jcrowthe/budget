/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, isZip, storeZip, unzip, utf8, utf8Decode, ZipError } from "../src/zip";

const enc = { encode: utf8 };

describe("crc32", () => {
  it("matches the check value", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("storeZip", () => {
  const csv = enc.encode('﻿"Category Group","Category"\n"é","Ünïcode ✓"');
  const big = new Uint8Array(70 * 1024).map((_, i) => (i * 31 + 7) & 0xff);
  const files = [
    { name: "budget-reflect-spending-breakdown-2026-11-15.csv", data: csv },
    { name: "budget-reflect-spending-breakdown-2026-11-15-transactions.csv", data: big },
  ];
  const zip = storeZip(files, "2026-11-15");
  const v = new DataView(zip.buffer);

  it("writes the signatures at their offsets", () => {
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const second = 30 + (files[0] as { name: string }).name.length + csv.length;
    expect(v.getUint32(second, true)).toBe(0x04034b50);
    const centralStart = second + 30 + (files[1] as { name: string }).name.length + big.length;
    expect(v.getUint32(centralStart, true)).toBe(0x02014b50);
    expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(zip.length - 22 + 10, true)).toBe(2);
    expect(v.getUint32(zip.length - 22 + 16, true)).toBe(centralStart);
    expect(v.getUint16(6, true)).toBe(0x0800);
    expect(v.getUint16(10, true)).toBe(0);
    expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 15);
  });

  it("writes the optional HH:mm in the local and central headers, and nothing without it", () => {
    const small = [{ name: "a.txt", data: utf8("x") }];
    const timed = storeZip(small, "2026-11-15", "19:51");
    const v = new DataView(timed.buffer);
    const want = (19 << 11) | (51 << 5);
    expect(v.getUint16(10, true)).toBe(want);
    const centralStart = 30 + "a.txt".length + 1;
    expect(v.getUint32(centralStart, true)).toBe(0x02014b50);
    expect(v.getUint16(centralStart + 12, true)).toBe(want);
    expect(storeZip(small, "2026-11-15")).toEqual(storeZip(small, "2026-11-15", undefined));
    expect(new DataView(storeZip(small, "2026-11-15").buffer).getUint16(10, true)).toBe(0);
  });

  it("is read back byte for byte by a standard reader (Python's zipfile)", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const path = join(dir, "out.zip");
    writeFileSync(path, zip);
    const script = [
      "import sys, zipfile, base64, json",
      "z = zipfile.ZipFile(sys.argv[1])",
      "print(json.dumps({'bad': z.testzip(), 'files': [[i.filename, base64.b64encode(z.read(i)).decode()] for i in z.infolist()]}))",
    ].join("\n");
    const r = spawnSync("python3", ["-I", "-c", script, path], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { bad: string | null; files: [string, string][] };
    expect(out.bad).toBeNull();
    expect(out.files.map((f) => f[0])).toEqual(files.map((f) => f.name));
    for (const [i, f] of files.entries()) {
      expect(new Uint8Array(Buffer.from(out.files[i]?.[1] as string, "base64"))).toEqual(f.data);
    }
  });
});

// EXF-477: the reader. The deflated zip is written here, by hand, with Node's deflate.
function writeZip(
  entries: { name: string; data: Uint8Array; method?: 0 | 8; flags?: number }[],
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const le = (n: number, bytes: number) => {
    const b = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) b[i] = Math.floor(n / 2 ** (8 * i)) & 0xff;
    return b;
  };
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let p = 0;
    for (const x of parts) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  };
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const name = utf8(e.name);
    const common = [
      le(20, 2),
      le(e.flags ?? 0x0800, 2),
      le(method, 2),
      le(0, 2),
      le(0x21, 2),
      le(crc32(e.data), 4),
      le(body.length, 4),
      le(e.data.length, 4),
      le(name.length, 2),
      le(0, 2),
    ];
    const local = cat(le(0x04034b50, 4), ...common, name, body);
    central.push(
      cat(
        le(0x02014b50, 4),
        le(20, 2),
        ...common,
        le(0, 2),
        le(0, 2),
        le(0, 2),
        le(0, 4),
        le(offset, 4),
        name,
      ),
    );
    chunks.push(local);
    offset += local.length;
  }
  const cd = cat(...central);
  return cat(
    ...chunks,
    cd,
    le(0x06054b50, 4),
    le(0, 2),
    le(0, 2),
    le(entries.length, 2),
    le(entries.length, 2),
    le(cd.length, 4),
    le(offset, 4),
    le(0, 2),
  );
}

const inflate = async (data: Uint8Array) => new Uint8Array(inflateRawSync(data));
const text = (d: Uint8Array) => utf8Decode(d);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ZipError ? e.code : `other: ${String(e)}`;
  }
  return "no error";
};

describe("unzip", () => {
  const body = enc.encode("one,two\r\n".repeat(500));
  const small = enc.encode("é ✓ 🛒");

  it("reads what storeZip wrote", async () => {
    const zip = storeZip(
      [
        { name: "a.csv", data: body },
        { name: "b.csv", data: small },
      ],
      "2026-11-15",
    );
    expect(isZip(zip)).toBe(true);
    const files = await unzip(zip, inflate);
    expect(files.map((f) => f.name)).toEqual(["a.csv", "b.csv"]);
    expect(Array.from(files[0]?.data ?? [])).toEqual(Array.from(body));
  });

  it("reads deflated entries and UTF-8 names, in central order", async () => {
    const zip = writeZip([
      { name: "Plan é 🛒.csv", data: body },
      { name: "stored.csv", data: small, method: 0 },
    ]);
    const files = await unzip(zip, inflate);
    expect(files.map((f) => f.name)).toEqual(["Plan é 🛒.csv", "stored.csv"]);
    expect(text(files[0]?.data as Uint8Array)).toBe("one,two\r\n".repeat(500));
    expect(text(files[1]?.data as Uint8Array)).toBe("é ✓ 🛒");
  });

  it("skips directories and __MACOSX entries", async () => {
    const zip = writeZip([
      { name: "dir/", data: new Uint8Array(), method: 0 },
      { name: "__MACOSX/._a.csv", data: small, method: 0 },
      { name: "a.csv", data: small },
    ]);
    expect((await unzip(zip, inflate)).map((f) => f.name)).toEqual(["a.csv"]);
  });

  it("inflates only the entries `only` accepts", async () => {
    const zip = writeZip([
      { name: "a.csv", data: body },
      { name: "notes.bin", data: body },
    ]);
    let inflated = 0;
    const counting = (d: Uint8Array) => {
      inflated++;
      return inflate(d);
    };
    const files = await unzip(zip, counting, {}, (n) => n.endsWith(".csv"));
    expect(files.map((f) => f.name)).toEqual(["a.csv"]);
    expect(inflated).toBe(1);
  });

  it("refuses an encrypted entry", async () => {
    expect(await code(unzip(writeZip([{ name: "a", data: small, flags: 1 }]), inflate))).toBe(
      "zip_encrypted",
    );
  });

  it("refuses a method other than stored or deflated (12)", async () => {
    const zip = writeZip([{ name: "a", data: small, method: 0 }]);
    const v = new DataView(zip.buffer);
    const cd = v.getUint32(zip.length - 22 + 16, true);
    v.setUint16(cd + 10, 12, true);
    expect(await code(unzip(zip, inflate))).toBe("zip_method");
  });

  it("refuses ZIP64 markers", async () => {
    const zip = writeZip([{ name: "a", data: small, method: 0 }]);
    const a = zip.slice();
    new DataView(a.buffer).setUint16(a.length - 22 + 10, 0xffff, true);
    expect(await code(unzip(a, inflate))).toBe("zip64");
    const b = zip.slice();
    new DataView(b.buffer).setUint32(b.length - 22 + 16, 0xffffffff, true);
    expect(await code(unzip(b, inflate))).toBe("zip64");
    const c = zip.slice();
    const cd = new DataView(c.buffer).getUint32(c.length - 22 + 16, true);
    new DataView(c.buffer).setUint32(cd + 24, 0xffffffff, true);
    expect(await code(unzip(c, inflate))).toBe("zip64");
  });

  it("refuses more than 8 entries and an entry over the bound", async () => {
    const nine = writeZip(
      Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, data: small, method: 0 as const })),
    );
    expect(await code(unzip(nine, inflate))).toBe("zip_too_many_entries");
    expect((await unzip(nine, inflate, { maxEntries: 9 })).length).toBe(9);
    const zip = writeZip([{ name: "a", data: body }]);
    expect(await code(unzip(zip, inflate, { maxEntryBytes: 100 }))).toBe("zip_entry_too_large");
  });

  it("refuses a bad CRC and a wrong inflated size", async () => {
    const zip = writeZip([{ name: "a", data: small, method: 0 }]);
    const bad = zip.slice();
    bad[30 + 1 + 2] = (bad[30 + 1 + 2] as number) ^ 0xff; // a data byte
    expect(await code(unzip(bad, inflate))).toBe("zip_crc");
    const deflated = writeZip([{ name: "a", data: body }]);
    expect(await code(unzip(deflated, async (d) => (await inflate(d)).slice(1)))).toBe("zip_crc");
  });

  it("refuses truncated and non-zip bytes", async () => {
    const zip = writeZip([{ name: "a", data: body }]);
    expect(await code(unzip(zip.slice(0, zip.length - 30), inflate))).toBe("zip_corrupt");
    expect(await code(unzip(enc.encode("not a zip at all, just text"), inflate))).toBe(
      "zip_corrupt",
    );
    expect(isZip(enc.encode("hello"))).toBe(false);
  });
});

describe("utf8Decode", () => {
  it("decodes two, three and four byte sequences and replaces bad bytes", () => {
    expect(utf8Decode(utf8("é€🛒 ok"))).toBe("é€🛒 ok");
    expect(utf8Decode(Uint8Array.from([0x61, 0xff, 0x62]))).toBe("a\ufffdb");
    expect(utf8Decode(Uint8Array.from([0xe2, 0x82]))).toBe("\ufffd\ufffd");
  });
});
