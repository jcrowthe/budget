import type { PlanImportOptions, PlanImportResult } from "@budget/schema/plan-import";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { ApiError } from "../api/client";
import { cancelImport, continueImport, startImport } from "../api/plan-import";

export type RunStep =
  | { kind: "writing"; result: PlanImportResult }
  | { kind: "failed"; result: PlanImportResult; detail: string }
  | { kind: "ended"; detail: string }
  | { kind: "cancelled" }
  | { kind: "done"; result: PlanImportResult };

const failedText = (e: unknown) => (e instanceof ApiError ? e.detail : "The connection failed.");

/** The import itself: the first request, then `continue` one at a time until done; retry and cancel. */
export function useImportRun(set: (s: RunStep) => void, onStartFailed: (detail: string) => void) {
  const qc = useQueryClient();
  const stopping = useRef(false);
  const looping = useRef<Promise<void>>(Promise.resolve());
  const last = useRef<PlanImportResult | null>(null);
  const finished = useRef(false);

  const done = useCallback(
    (result: PlanImportResult) => {
      if (finished.current) return;
      finished.current = true;
      set({ kind: "done", result });
      void qc.invalidateQueries({ queryKey: ["budgets"] });
    },
    [qc, set],
  );

  const loop = useCallback(
    async (first: PlanImportResult) => {
      let r = first;
      last.current = r;
      while (r.state === "writing" && !stopping.current) {
        set({ kind: "writing", result: r });
        try {
          r = await continueImport(r.import_id);
          last.current = r;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) set({ kind: "ended", detail: e.detail });
          else set({ kind: "failed", result: r, detail: failedText(e) });
          return;
        }
      }
      if (r.state === "done") done(r);
    },
    [done, set],
  );

  const run = useCallback(
    (first: PlanImportResult) => {
      looping.current = loop(first);
      return looping.current;
    },
    [loop],
  );

  const start = useCallback(
    async (files: readonly File[], options: PlanImportOptions) => {
      stopping.current = false;
      finished.current = false;
      let r: PlanImportResult;
      try {
        r = await startImport(files, options);
      } catch (e) {
        onStartFailed(e instanceof ApiError ? e.detail : "The connection failed.");
        return;
      }
      if (r.state === "done") {
        last.current = r;
        done(r);
      } else await run(r);
    },
    [done, onStartFailed, run],
  );

  const retry = useCallback(async () => {
    const r = last.current;
    if (!r) return;
    stopping.current = false;
    await run(r);
  }, [run]);

  const cancel = useCallback(async () => {
    stopping.current = true;
    await looping.current;
    const r = last.current;
    if (!r || finished.current) return;
    try {
      await cancelImport(r.import_id);
      set({ kind: "cancelled" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.errorName === "import_finished") {
        try {
          done(await continueImport(r.import_id));
          return;
        } catch (e2) {
          set({ kind: "failed", result: r, detail: failedText(e2) });
          return;
        }
      }
      set({
        kind: "failed",
        result: r,
        detail: `The import could not be cancelled: ${failedText(e)}`,
      });
    }
  }, [done, set]);

  return { start, retry, cancel };
}
