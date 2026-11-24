import type { UndoWhere } from "@budget/schema/changes";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import {
  getSnapshot,
  redo as redoStep,
  type Scope,
  subscribe,
  undoState,
  undo as undoStep,
} from "./store";

/** The Undo/Redo stacks of one plan. After a success the plan's queries refetch and `where` is returned. */
export function useUndo(budgetId: string, scope?: Scope) {
  const qc = useQueryClient();
  useSyncExternalStore(subscribe, () => getSnapshot(budgetId));
  const { canUndo, canRedo } = undoState(budgetId, scope);
  const run = useCallback(
    async (step: typeof undoStep): Promise<UndoWhere | undefined> => {
      try {
        return await step(budgetId, scope);
      } finally {
        await qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });
      }
    },
    [budgetId, scope, qc],
  );
  return {
    canUndo,
    canRedo,
    undo: () => run(undoStep),
    redo: () => run(redoStep),
  };
}
