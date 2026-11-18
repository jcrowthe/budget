import { checkImportFiles } from "../apps/web/src/plan-import/plan-import-dialog-files";
import { latestOnly } from "../apps/web/src/plan-import/plan-import-dialog-latest";
import { IMPORT_LIMITS } from "../packages/schema/src/plan-import";
import { expect, test } from "./fixtures";

const f = (name: string, size = 10) => ({ name, size });

test("15 checkImportFiles: each refusal and both accepted forms", () => {
  expect(checkImportFiles([])).toEqual({
    ok: false,
    message: "Choose the zip made by Export Plan, or its Plan and Register files.",
  });
  expect(checkImportFiles([f("a.xlsx")])).toEqual({
    ok: false,
    message: "a.xlsx is not a .zip, .csv or .tsv file.",
  });
  expect(checkImportFiles([f("a.csv"), f("b.TXT")])).toEqual({
    ok: false,
    message: "b.TXT is not a .zip, .csv or .tsv file.",
  });
  const choose = "Choose one zip, or the two files: Plan and Register.";
  expect(checkImportFiles([f("a.zip"), f("b.csv")])).toEqual({ ok: false, message: choose });
  expect(checkImportFiles([f("a.zip"), f("b.zip")])).toEqual({ ok: false, message: choose });
  expect(checkImportFiles([f("a.csv"), f("b.csv"), f("c.csv")])).toEqual({
    ok: false,
    message: choose,
  });
  expect(checkImportFiles([f("a.csv")])).toEqual({
    ok: false,
    message: "Choose both files: Plan and Register.",
  });
  expect(checkImportFiles([f("a.zip", IMPORT_LIMITS.uploadBytes + 1)])).toEqual({
    ok: false,
    message: "The files are larger than 20 MB, the most an import takes.",
  });
  expect(checkImportFiles([f("a.ZIP", IMPORT_LIMITS.uploadBytes)])).toEqual({
    ok: true,
    kind: "zip",
  });
  expect(checkImportFiles([f("a.csv"), f("b.tsv")])).toEqual({ ok: true, kind: "pair" });
});

test("15 latestOnly: an older answer arriving last is dropped", async () => {
  const latest = latestOnly();
  const first = latest.next();
  const second = latest.next();
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  const applied: number[] = [];
  const answer = (seq: number, ms: number) =>
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (latest.isLatest(seq)) applied.push(seq);
        resolve();
      }, ms),
    );
  await Promise.all([answer(second.seq, 5), answer(first.seq, 30)]);
  expect(applied).toEqual([second.seq]);
  expect(latest.isLatest(first.seq)).toBe(false);
});
