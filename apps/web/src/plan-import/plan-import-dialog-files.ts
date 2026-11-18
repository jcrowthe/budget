import { IMPORT_LIMITS } from "@budget/schema/plan-import";

export type FileCheck = { ok: true; kind: "zip" | "pair" } | { ok: false; message: string };

const ext = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** What a choice of files may be before any upload: one zip, or the Plan and Register files. */
export function checkImportFiles(files: readonly { name: string; size: number }[]): FileCheck {
  if (files.length === 0)
    return {
      ok: false,
      message: "Choose the zip made by Export Plan, or its Plan and Register files.",
    };
  const bad = files.find((f) => !["zip", "csv", "tsv"].includes(ext(f.name)));
  if (bad) return { ok: false, message: `${bad.name} is not a .zip, .csv or .tsv file.` };
  const zips = files.filter((f) => ext(f.name) === "zip").length;
  let kind: "zip" | "pair";
  if (files.length === 1 && zips === 1) kind = "zip";
  else if (files.length === 2 && zips === 0) kind = "pair";
  else if (files.length === 1)
    return { ok: false, message: "Choose both files: Plan and Register." };
  else return { ok: false, message: "Choose one zip, or the two files: Plan and Register." };
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > IMPORT_LIMITS.uploadBytes)
    return {
      ok: false,
      message: `The files are larger than ${IMPORT_LIMITS.uploadBytes / 2 ** 20} MB, the most an import takes.`,
    };
  return { ok: true, kind };
}
