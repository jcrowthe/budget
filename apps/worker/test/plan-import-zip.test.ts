import { env } from "cloudflare:test";
import { storeZip, unzip, utf8, ZipError } from "@budget/schema/zip";
import { describe, expect, it } from "vitest";
import { inflateRaw } from "../src/services/plan-import";
import { deflatedZip } from "./plan-import-helpers";

void env;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ZipError ? e.code : `other: ${String(e)}`;
  }
  return "no error";
};

describe("task 0: DecompressionStream('deflate-raw') in the Worker pool", () => {
  it("inflates what CompressionStream deflated", async () => {
    const text = "plan,rows\r\n".repeat(5000);
    const raw = new TextEncoder().encode(text);
    const compressed = new Uint8Array(
      await new Response(
        new Blob([raw as unknown as ArrayBuffer])
          .stream()
          .pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );
    expect(compressed.length).toBeLessThan(raw.length / 10);
    const back = await inflateRaw(compressed, raw.length);
    expect(new TextDecoder().decode(back)).toBe(text);
  });

  it("refuses output larger than the stated size and corrupt input", async () => {
    const raw = new TextEncoder().encode("abc".repeat(1000));
    const compressed = new Uint8Array(
      await new Response(
        new Blob([raw as unknown as ArrayBuffer])
          .stream()
          .pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );
    expect(await code(inflateRaw(compressed, 10))).toBe("zip_crc");
    expect(await code(inflateRaw(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 100))).toMatch(/zip_/);
  });
});

describe("zip reader in the Worker pool (case 11)", () => {
  const body = new TextEncoder().encode("one,two\r\n".repeat(300));
  it("reads stored (storeZip) and deflated (own writer) entries with UTF-8 names", async () => {
    const stored = storeZip([{ name: "Plan é.csv", data: body }], "2026-11-15");
    const a = await unzip(stored, inflateRaw);
    expect(a[0]?.name).toBe("Plan é.csv");
    expect(a[0]?.data.length).toBe(body.length);
    const deflated = await deflatedZip([
      { name: "Plan é 🛒.csv", data: body },
      { name: "b.csv", data: "x" },
    ]);
    const b = await unzip(deflated, inflateRaw);
    expect(b.map((e) => e.name)).toEqual(["Plan é 🛒.csv", "b.csv"]);
    expect(new TextDecoder().decode(b[0]?.data)).toBe(new TextDecoder().decode(body));
  });

  it("refuses an encrypted entry, ZIP64, method 12, 9 entries, an entry over the bound, a bad CRC and a truncated file", async () => {
    const zip = await deflatedZip([{ name: "a.csv", data: body }]);
    const v = (b: Uint8Array) => new DataView(b.buffer);
    const cdOf = (b: Uint8Array) => v(b).getUint32(b.length - 22 + 16, true);

    const enc = zip.slice();
    v(enc).setUint16(cdOf(enc) + 8, 0x0801, true);
    expect(await code(unzip(enc, inflateRaw))).toBe("zip_encrypted");

    const z64 = zip.slice();
    v(z64).setUint16(z64.length - 22 + 10, 0xffff, true);
    expect(await code(unzip(z64, inflateRaw))).toBe("zip64");

    const m12 = zip.slice();
    v(m12).setUint16(cdOf(m12) + 10, 12, true);
    expect(await code(unzip(m12, inflateRaw))).toBe("zip_method");

    const nine = storeZip(
      Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, data: utf8("x") })),
      "2026-11-15",
    );
    expect(await code(unzip(nine, inflateRaw))).toBe("zip_too_many_entries");

    expect(await code(unzip(zip, inflateRaw, { maxEntryBytes: 100 }))).toBe("zip_entry_too_large");

    const crc = zip.slice();
    v(crc).setUint32(cdOf(crc) + 16, 123, true);
    expect(await code(unzip(crc, inflateRaw))).toBe("zip_crc");

    expect(await code(unzip(zip.slice(0, zip.length - 40), inflateRaw))).toBe("zip_corrupt");
  });
});
