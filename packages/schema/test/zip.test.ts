/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, storeZip, utf8 } from "../src/zip";

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
