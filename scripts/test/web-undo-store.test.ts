import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../apps/web/src/api/client";

// zod is not resolvable from scripts/, so the api module is mocked.
vi.mock("../../apps/web/src/api/changes", () => ({ undoChangeSet: vi.fn() }));

import { undoChangeSet } from "../../apps/web/src/api/changes";
import {
  __resetForTests,
  CAP,
  getSnapshot,
  mark,
  recordChange,
  redo,
  undo,
  undoState,
} from "../../apps/web/src/undo/store";

const api = vi.mocked(undoChangeSet);
const B = "plan-1";
const where = { surface: "plan", month: null, category_ids: [] } as const;
let n = 0;
const ok = () =>
  api.mockImplementationOnce(async (_b, id) => ({
    change_set_id: `u-${id}-${n++}`,
    undone_change_set_id: id,
    entities: 1,
    where,
  }));

beforeEach(() => {
  __resetForTests();
  api.mockReset();
});

describe("undo store", () => {
  it("recordChange clears Redo", async () => {
    recordChange(B, "s1", "register");
    ok();
    await undo(B);
    expect(getSnapshot(B).redo).toHaveLength(1);
    recordChange(B, "s2", "register");
    expect(getSnapshot(B).redo).toHaveLength(0);
  });

  it("undo moves the entry to Redo under the undo's id", async () => {
    recordChange(B, "s1", "plan");
    ok();
    const w = await undo(B);
    expect(w).toEqual(where);
    expect(api).toHaveBeenCalledWith(B, "s1");
    const s = getSnapshot(B);
    expect(s.undo).toHaveLength(0);
    expect(s.redo.map((e) => e.changeSetId)).toEqual([expect.stringMatching(/^u-s1-/)]);
    ok();
    await redo(B);
    expect(getSnapshot(B).redo).toHaveLength(0);
    expect(getSnapshot(B).undo).toHaveLength(1);
  });

  it("a new record after an undo empties Redo", async () => {
    recordChange(B, "s1", "register");
    recordChange(B, "s2", "register");
    ok();
    await undo(B);
    expect(undoState(B).canRedo).toBe(true);
    recordChange(B, "s3", "register");
    expect(undoState(B).canRedo).toBe(false);
  });

  it("holds at most CAP entries, dropping the oldest", () => {
    for (let i = 0; i < CAP + 5; i++) recordChange(B, `s${i}`, "register");
    const s = getSnapshot(B).undo;
    expect(s).toHaveLength(CAP);
    expect(s[0]?.changeSetId).toBe("s5");
    expect(s.at(-1)?.changeSetId).toBe(`s${CAP + 4}`);
  });

  it("a stale error drops the entry from both stacks and rethrows", async () => {
    recordChange(B, "s1", "register");
    api.mockRejectedValueOnce(new ApiError(409, "409", "undo_stale", "transaction x changed"));
    await expect(undo(B)).rejects.toMatchObject({ errorName: "undo_stale" });
    const s = getSnapshot(B);
    expect(s.undo).toHaveLength(0);
    expect(s.redo).toHaveLength(0);
    expect(s.busy).toBe(false);
  });

  it("a network error puts the entry back", async () => {
    recordChange(B, "s1", "register");
    api.mockRejectedValueOnce(new TypeError("network"));
    await expect(undo(B)).rejects.toThrow("network");
    expect(getSnapshot(B).undo).toHaveLength(1);
  });

  it("an origin mismatch, or an entry from before the mark, disables the hook", () => {
    recordChange(B, "s1", "register");
    const since = mark();
    const scope = { origin: "payees", since } as const;
    expect(undoState(B, scope).canUndo).toBe(false);
    recordChange(B, "s2", "register");
    expect(undoState(B, scope).canUndo).toBe(false);
    recordChange(B, "s3", "payees");
    expect(undoState(B, scope).canUndo).toBe(true);
    expect(undoState(B, { origin: "payees", since: mark() }).canUndo).toBe(false);
    expect(undoState(B).canUndo).toBe(true);
  });
});
