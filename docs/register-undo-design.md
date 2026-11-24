# Register Undo / Redo: design

EXF-530, unit U3 of plan p_66a8e22e545f480d8c0c4092571b8e09. It builds on the change sets (U1) and the undo engine
and store (U2) in [undo-design.md](undo-design.md). This unit wires the register: it records the user's register
actions, adds the toolbar buttons and the shortcuts, and navigates and selects after an undo or redo.

## Stack scope (D2)

- One in-memory Undo/Redo pair per plan per tab (`apps/web/src/undo/store.ts`), shared by every register (account
  pages and All Accounts), the Plan page (EXF-504, later) and Manage Payees.
- Registers pass no scope to `useUndo`, so they act on the shared top entry, whichever surface recorded it.
- A reload clears both stacks.

## What is recorded

Recording happens in the api hooks. Each hook's request passes
`onChangeSet: (id) => recordChange(budgetId, id, "register")` to `apiFetch`. Only the register's surfaces use these
hooks, so the call sites (`ActionBar`, `EntryRow`, `RegisterTable`, `AttentionMenu`, `manual-match-details`,
`rename-rules-bank-import`, `AccountHeader`) are unchanged. The raw request functions (`updateTransaction`,
`bulkTransactions`, …) record only when they are given a callback.

| action | hook (file) | recorded |
|---|---|---|
| add, edit, split, transfer (inline save); "Don't rename as" | `useSaveTransaction` (`api/transactions.ts`) | yes |
| flag a row | `useSetFlag` | yes |
| clear or unclear a row (the C column) | `useSetCleared` | yes |
| bulk clear, unclear, duplicate, delete, categorize, flag, memo, move | `useBulkTransactions` | yes |
| approve, reject | `useApproveReject` | yes |
| bank match, unmatch | `useMatchTransactions`, `useUnmatchTransaction` | yes; the engine refuses them (409 `undo_refused`), and the refusal shows |
| star toggle | `useSetStarred` (`api/accounts.ts`) | yes |
| scheduled create, edit | `useCreateScheduled`, `useUpdateScheduled` (`api/scheduledTransactions.ts`) | yes |
| scheduled Delete and Enter Now | `useScheduledBulk` | yes |
| enter-due-on-open (EXF-658) | `useEnterDueOnOpen` | no |
| syncs, file and plan imports, reconcile, account create/edit/close/reopen/delete, view and ui settings | – | no |

## Buttons and keys

- Toolbar order: "Add Transaction · File Import · (Record Payment) · │ · Undo · Redo". Below a 1000px toolbar, Undo
  and Redo move into More with the same behaviour.
- A button shows its tooltip only while it is enabled:
  - Undo: "Undo the last thing you did (in Budget, not in life)."
  - Redo: "Redo that thing you just undid. Practice decisiveness."
- Undo is disabled when:
  - nothing can be undone;
  - an entry row is open (add or edit);
  - any mutation is in flight (its change set is not recorded yet);
  - an undo or redo is running.
- Redo is disabled until something has been undone. A new recorded change clears Redo.
- A closed account's register keeps Undo enabled. The engine refuses what it must (a restore into a closed account),
  and the refusal shows.
- Keys, bound with `useShortcut` while a register is mounted: `undo` (ctrl/⌘+Z), and `redo` (ctrl/⌘+shift+Z and
  ctrl/⌘+Y). The dispatcher ignores them in fields (so ctrl+Z in Memo is the browser's own text undo) and while a
  dialog or menu is open.

## After an undo or redo

1. `useUndo` invalidates every query of the plan before it returns. This is the "invalidateFor" step.
2. The register follows the engine's `where` (D6):
   - `surface: "register"` on All Accounts → stay;
   - on another account's page → open `where.account_id`;
   - on the same account → stay.
   - Then select `where.transaction_ids` (router state `select`, read by `RegisterTable`). With no ids (an undone
     create, a star, a schedule), the selection is cleared.
   - `surface: "plan"` → the Plan page at `where.month`. `surface: "payees"` → stay.
3. On 409 (`undo_stale`, `undo_refused`, `already_undone`), 403 (`forbidden`) or any other error, the error's detail
   shows under the toolbar in the register's notice style (`register-action-bar-error`, `role="alert"`). The store
   has already dropped the entry (or put it back, on a network error or 5xx).

## Departures

- **No label and no `where` at record time.** The contract asked for both in each record call. `recordChange` takes
  neither, and `apps/web/src/undo/**` is closed to this unit. Navigation uses the `where` the engine answers (D6), and
  the tooltips are fixed copy, so a label would be shown nowhere.
- **Names.** The contract's `useUndoRedo` is `useUndo`, and its `invalidateFor` is the invalidation inside `useUndo`.
- **Enter Now is recorded.** It is a register bulk action the user starts, and D5 excludes only enter-due-on-open.
- **Match and unmatch are recorded**, so Undo shows the refusal and does not skip silently to an older action.
- **Hidden rows.** A restored row that the View options hide (date range, reconciled) is not selected.
- **Keys on a checkbox.** A row checkbox is an `input`, so ctrl+Z pressed right after ticking one is ignored by the
  shared dispatcher (`shortcuts/dispatcher.ts`, outside this unit).
- **The reject test** dresses rows as imports and answers the reject route, as `e2e/register-approve*` does. Its
  answer comes from a real bulk delete and carries that delete's change set, so the Undo runs the real engine. The
  engine's reject-and-tombstone path is covered by the worker test (`apps/worker/test/undo.test.ts`).
- **`docs/README.md`** gets no index line: it is outside this unit's files.
- **Refusal text.** The notice shows the engine's `detail` as it is, for example "transaction <id> changed after this
  action, so it can't be undone". The id is the engine's wording; this unit does not rewrite it.
- **Keys wait for the write.** While a mutation is in flight (`useIsMutating() > 0`) ctrl+Z is ignored, as the disabled
  button is. A key pressed in that window does nothing and is not queued; the e2e waits for the button to enable.
