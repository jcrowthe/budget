# Plan Undo/Redo design (EXF-504)

Plan p_66a8e22e545f480d8c0c4092571b8e09, unit U4. The Plan toolbar's Undo and Redo, and ctrl/⌘+Z, ctrl/⌘+Y and
ctrl/⌘+shift+Z, undo and redo the user's own Plan actions in this tab, several levels deep. It builds on the change
sets, the undo engine and the web store of [undo-design.md](undo-design.md) (U1, U2). The register undo (EXF-530)
shares the same stack (D2).

## Actions covered

Each write puts its change set on the plan's shared stack through `apiFetch`'s `onChangeSet`, with origin `"plan"`
(`recordPlan` in `apps/web/src/api/assigned.ts`). One request is one step.

| action | where it is recorded | recorded `where` |
|---|---|---|
| Assigned edit (grid cell, target cards' assign) | `api/assigned.ts` `useCommitAssigned`, one per commit | `{ month, categoryIds: [category] }` |
| Move, cover, Fix This, Assign Manually | `api/moves.ts` `postMove` / `postCover` through `useMoveMoney` | `{ month, categoryIds: [the non-RTA sides] }` |
| Create group or category | `api/categories.ts` `useCategoryActions` | `{ month: null, categoryIds: [category] or [] }` |
| Rename, hide, unhide (group or category) | `api/categories.ts` `updateGroup` / `updateCategory` through `useCategoryActions` | same |
| Delete category or group (with or without reassign) | `api/categories.ts` `deleteCategory` / `deleteGroup` through `useCategoryActions` (the dialog stays untouched) | same |
| Unhide all | `api/categories.ts` `unhideAll` | `{ month: null, categoryIds: [] }` |
| Auto-Assign run (D5) | `api/autoAssign.ts` `useAutoAssign` | `{ month, categoryIds: [scope ids] or [] }` |
| Target save or delete, card payment targets included (EXF-538) | `api/targets.ts` `useSaveTarget` / `useDeleteTarget` | `{ month: null, categoryIds: [category] }` |

Not recorded:
- Collapse and expand (`setGroupsCollapsed`): interface state with no undoable row. It calls the raw `updateGroup`,
  which records nothing.
- Target snooze: the engine always refuses `target_snooze`.
- Category notes: not in EXF-504's list (see Points that need the source).

## Undo and Redo on the Plan page

- The buttons read `useUndo(budgetId)` (`canUndo`, `canRedo`). Both are disabled on load; Redo stays disabled until an
  undo. A title shows only while a button is enabled:
  - Undo: "Undo the last thing you did (in Budget, not in life)."
  - Redo: "Redo that thing you just undid. Practice decisiveness."
- `PlanGrid` binds the registry's `undo` and `redo` with `useShortcut` while the Plan page is mounted. The dispatcher
  ignores keys typed in a field or with a dialog open, so ctrl+Z in the Assigned input stays the input's own.
- One press runs:
  1. **Navigate first (D6):** if the top entry's recorded month is not the shown one, go to it.
  2. The store's `undo`/`redo`, inside the plan's write queue (`monthCache` `beginWrite`, `inOrder`, `endWrite`). An
     undo therefore never overtakes an Assigned PATCH still in flight.
  3. The undo's own change set inherits the recorded `where`, so a redo navigates too. If the entry was not
     recorded by the Plan, the server's `where` (plan surface, non-null month) is used after the undo.
  4. The plan's non-month queries are invalidated. `endWrite` refetches the months once no write is pending.
  5. On 409, 403 or 404 the store drops the entry, and the error's detail shows in the grid notice. Any other failure
     shows "Couldn't undo." (or redo) and the store keeps the entry.
- The stacks live in memory per tab, so a reload clears them.

## Departures

- **`invalidateFor` and `useUndoRedo` do not exist.** The hook is `useUndo`. The Plan uses it for the button state,
  but runs the store's `undo`/`redo` in the plan write queue. The hook refetches every plan query at once, which
  breaks the cached-month rule when another write is pending. The Plan invalidates the non-month queries itself and
  leaves the months to `endWrite`.
- **`where` is kept by the Plan.** `recordChange` takes no `where`, and the store is closed to this unit. So
  `api/assigned.ts` keeps a change set → `where` map in memory, bounded, and cleared by a reload.
- **Category, group and target writes record `month: null`.** They do not depend on the month, so their undo stays
  on the shown month. For a delete with reassign, the server's `where.month` is whichever merged cell comes first, so
  it is ignored when the Plan recorded the entry.
- **The docs index (`docs/README.md`) is not updated.** It is outside this unit's files.

## Points that need the source

- Whether editing a category note is an undo step. The engine could reverse it (`note` is mapped); it is left out
  because the ticket does not list it.
- What Undo does on the Plan page when the shared top entry is a register or payees change (D2). Here the change is
  undone in place, without navigating to the register.
- Whether target edits and Auto-Assign runs show a navigation. Here targets do not navigate, and Auto-Assign goes to
  its month.
- Whether Undo, pressed while an Assigned cell is open, commits the cell first. Here the key goes to the input, so
  it is the input's own undo.
- Whether Recent Moves lists the reversing entry. EXF-504 says it keeps both; Recent Moves is not built yet.
