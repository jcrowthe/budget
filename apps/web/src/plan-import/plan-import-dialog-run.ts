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

export type CancelOutcome = "cancelled" | "none" | "done" | "failed";

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
    (files: readonly File[], options: PlanImportOptions) => {
      stopping.current = false;
      finished.current = false;
      last.current = null;
      // The whole start-then-loop is what cancel waits for, so a cancel during the first request cancels it.
      looping.current = (async () => {
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
        } else await loop(r);
      })();
      return looping.current;
    },
    [done, loop, onStartFailed],
  );

  const retry = useCallback(async () => {
    const r = last.current;
    if (!r) return;
    stopping.current = false;
    await run(r);
  }, [run]);

  /** "cancelled" and "none" (nothing was started) leave nothing; "done" and "failed" show their step. */
  const cancel = useCallback(async (): Promise<CancelOutcome> => {
    stopping.current = true;
    await looping.current;
    const r = last.current;
    if (finished.current) return "done";
    if (!r) return "none";
    try {
      await cancelImport(r.import_id);
      set({ kind: "cancelled" });
      return "cancelled";
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.errorName === "import_finished") {
        try {
          done(await continueImport(r.import_id));
          return "done";
        } catch (e2) {
          set({ kind: "failed", result: r, detail: failedText(e2) });
          return "failed";
        }
      }
      set({
        kind: "failed",
        result: r,
        detail: `The import could not be cancelled: ${failedText(e)}`,
      });
      return "failed";
    }
  }, [done, set]);

  return { start, retry, cancel };
}
