import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeFileText,
  FileImportError,
  fileFormatOf,
  readCsv,
  readFileText,
  readOfx,
  readQif,
} from "../src/file-import-read";

const fx = (n: string) =>
  readFileSync(join(import.meta.dirname, "fixtures/file-import", n), "utf8");

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    if (e instanceof FileImportError) return e.code;
    throw e;
  }
  return null;
}

describe("fileFormatOf", () => {
  it("fileFormatOf reads the extension case-insensitively", () => {
    expect(fileFormatOf("a.CSV")).toBe("csv");
    expect(fileFormatOf("b.Qfx")).toBe("qfx");
    expect(fileFormatOf("d.tsv")).toBe("tsv");
    expect(fileFormatOf("e.ofx")).toBe("ofx");
    expect(fileFormatOf("f.qif")).toBe("qif");
    expect(fileFormatOf("c.txt")).toBeNull();
    expect(fileFormatOf("noext")).toBeNull();
  });
});

describe("readCsv", () => {
  it("readCsv returns the cells of the EXF-531 sample", () => {
    const { cells } = readCsv(fx("sample.csv"), ",");
    expect(cells).toHaveLength(3);
    for (const row of cells) expect(row).toHaveLength(5);
    expect(cells[2]?.[4]).toBe("250.00");
    expect(cells[1]?.[4]).toBe("");
  });

  it("readCsv reads a TSV with TAB", () => {
    const { cells } = readCsv(fx("sample.tsv"), "\t");
    expect(cells).toEqual([
      ["Date", "Payee", "Memo", "Amount"],
      ["2026-11-10", "Sample Cafe", "latte", "-4.50"],
      ["2026-11-12", "Sample Payroll", "salary", "250.00"],
    ]);
  });

  it("readCsv strips a BOM and reads CRLF and quoted fields", () => {
    const { cells } = readCsv('﻿A,B\r\n"x, ""y""",z\r\n', ",");
    expect(cells).toEqual([
      ["A", "B"],
      ['x, "y"', "z"],
    ]);
  });

  it("readCsv: an unclosed quote is unreadable and an empty file is no_rows", () => {
    expect(codeOf(() => readCsv('a,"b\n', ","))).toBe("unreadable");
    expect(codeOf(() => readCsv("", ","))).toBe("no_rows");
    expect(codeOf(() => readCsv("\n\n", ","))).toBe("no_rows");
  });
});

describe("readOfx", () => {
  it("readOfx reads SGML", () => {
    const { entries } = readOfx(fx("sgml.ofx"));
    expect(entries).toEqual([
      { date: "2026-11-10", amount: -4500, fitid: "ZZ1001", name: "Sample Cafe", memo: "latte" },
      {
        date: "2026-11-12",
        amount: 250000,
        fitid: "ZZ1002",
        name: "Sample Bread & Co",
        memo: "salary",
      },
      {
        date: "2026-11-13",
        amount: -4500,
        fitid: "ZZ1001",
        name: "Sample Cafe",
        memo: "latte again",
      },
    ]);
  });

  it("readOfx reads XML with PAYEE/NAME", () => {
    const { entries } = readOfx(fx("xml.ofx"));
    expect(entries).toEqual([
      {
        date: "2026-11-10",
        amount: -12340,
        fitid: "ZZ2001",
        name: "Sample Grocer",
        memo: "weekly",
      },
      { date: "2026-11-11", amount: 5000, fitid: null, name: "Sample Refund", memo: null },
    ]);
  });

  it("readOfx reads QFX", () => {
    const { entries } = readOfx(fx("sample.qfx"));
    expect(entries).toEqual([
      { date: "2026-11-14", amount: -7250, fitid: "ZZ3001", name: "SAMPLE DINER", memo: "lunch" },
      {
        date: "2026-11-16",
        amount: 100000,
        fitid: "ZZ3002",
        name: "Sample Transfer In",
        memo: null,
      },
    ]);
  });

  it("readOfx: no <OFX> is unreadable, no STMTTRN is no_rows", () => {
    expect(codeOf(() => readOfx("hello"))).toBe("unreadable");
    expect(codeOf(() => readOfx("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>"))).toBe("no_rows");
  });
});

describe("readQif", () => {
  it("readQif reads Bank records with T and U", () => {
    const { entries } = readQif(fx("sample.qif"));
    expect(entries).toEqual([
      { dateText: "11/10'26", amount: -4500, payee: "Sample Cafe", memo: "latte" },
      { dateText: "11/12'26", amount: 250000, payee: "Sample Payroll", memo: "salary" },
      { dateText: "12/1'26", amount: -1020000, payee: "Sample Rent", memo: null },
    ]);
  });

  it("readQif: an investment type is unsupported_format, no !Type is unreadable, no record is no_rows", () => {
    expect(codeOf(() => readQif("!Type:Invst\nD1/1'26\nT1.00\n^\n"))).toBe("unsupported_format");
    expect(codeOf(() => readQif("D1/1'26\nT1.00\n^\n"))).toBe("unreadable");
    expect(codeOf(() => readQif("!Type:Bank\n"))).toBe("no_rows");
  });
});

describe("readFileText", () => {
  it("readFileText dispatches on the extension and refuses others as unsupported_format", () => {
    expect(readFileText("a.csv", fx("sample.csv")).format).toBe("csv");
    expect(readFileText("a.TSV", fx("sample.tsv")).format).toBe("tsv");
    expect(readFileText("a.ofx", fx("sgml.ofx")).format).toBe("ofx");
    expect(readFileText("a.qfx", fx("sample.qfx")).format).toBe("qfx");
    expect(readFileText("a.qif", fx("sample.qif")).format).toBe("qif");
    expect(codeOf(() => readFileText("a.txt", "x"))).toBe("unsupported_format");
  });
});

describe("decodeFileText", () => {
  it("decodeFileText honours CHARSET:1252, a BOM and falls back from bad UTF-8", () => {
    const labels: string[] = [];
    const decoder = (b: Uint8Array, l: "utf-8" | "windows-1252") => {
      labels.push(l);
      return new TextDecoder(l).decode(b);
    };
    const latin = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

    const ofx = latin(
      "OFXHEADER:100\r\nDATA:OFXSGML\r\nCHARSET:1252\r\n\r\n<OFX><NAME>Caf\xe9\r\n",
    );
    expect(decodeFileText(ofx, decoder)).toContain("<NAME>Café");
    expect(labels.at(-1)).toBe("windows-1252");

    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("Date,Payee\n", "utf8")]);
    expect(decodeFileText(bom, decoder)).toBe("Date,Payee\n");
    expect(labels.at(-1)).toBe("utf-8");

    const csv = latin("Date,Payee\n11/10/2026,Caf\xe9\n");
    expect(decodeFileText(csv, decoder)).toBe("Date,Payee\n11/10/2026,Café\n");
    expect(labels.slice(-2)).toEqual(["utf-8", "windows-1252"]);

    const utf8 = new Uint8Array(Buffer.from("Date,Payee\n11/10/2026,Café\n", "utf8"));
    expect(decodeFileText(utf8, decoder)).toBe("Date,Payee\n11/10/2026,Café\n");
  });
});
