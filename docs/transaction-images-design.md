# Transaction images: design (EXF-536)

The user can attach one image, such as a receipt, to a transaction, then view, download or delete it. Every register
(account pages and All Accounts) has an image column. The existing View option "Show Images" (`show_images`,
`packages/schema/src/view-settings.ts`) hides that column.

## Behaviour

- **Empty cell.** A grey photo icon with the tooltip "Add Image". Clicking it opens the file chooser with
  `accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml"`.
- **With an image.** The cell shows a small thumbnail button titled "Transaction Photo".
- **Viewer.** Clicking the thumbnail opens a full-screen dimmed overlay (`role="dialog"`, `aria-modal`). The image
  is centred, and a bottom bar holds "Delete Image", "Download Image" and "Close". Escape also closes the overlay;
  while the delete confirm is open, Escape closes only the confirm.
- **Delete.** It asks first, using the register's `DeleteDialog`:
  - title "Delete Image";
  - body "Are you sure you want to delete this image?";
  - buttons Cancel and Delete.

  After a delete, the cell shows the icon again.
- **Rows without an image cell.** Split lines, the add/edit entry row, pending rows and scheduled rows get an empty
  cell with no button. This keeps every body row's cell count equal to the header's.

## API

| operation | answer |
|---|---|
| `PUT /api/v1/budgets/{budget_id}/transactions/{transaction_id}/image` | Multipart, one `file` part. Answers 200 `{ data: TransactionImage }`. A second PUT replaces the image. |
| `GET …/image` | Streams the bytes from R2 with their `Content-Type`, `ETag` (304 on `If-None-Match`), `Cache-Control: private, no-cache`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename=…` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`. The policy keeps an SVG opened directly from running script. |
| `DELETE …/image` | 200 `{ data: { transaction_id, deleted: true } }`. |

`TransactionImage` is `{ transaction_id, content_type, byte_size, file_name, created_at }`. Transactions expose
`has_image` (boolean) on every read: list, single, the register read with running balance, and All Accounts.

**Refusals:**
- 415 `unsupported_media_type`: the declared type is not one of the six, or the bytes do not match it.
  - Raster types are checked by their magic numbers.
  - SVG must be text whose first element is `<svg`, after an optional XML prolog, comments and doctype.
- 413 `file_too_large`: more than 10 MiB (10 × 1024 × 1024 bytes). The route checks `Content-Length` first (the limit
  plus 64 KiB of multipart overhead), then the part's size.
- 422: an empty or missing part.
- 404: the plan, the live transaction or the image is missing. A split line or a soft-deleted transaction counts as
  missing.

**MCP** (tool count 131 → 133):
- `attach_transaction_image(budget_id, transaction_id, content_base64, content_type)`. `content_type` is an enum of the
  six types, so the schema rejects any other value. The decoded bytes go through the same checks as REST.
- `delete_transaction_image(budget_id, transaction_id)`.
- The GET has an `excluded` line in `test/mcp-coverage/transaction-images.ts`: it returns a binary stream for the
  browser, not a `data` object. Agents read `has_image`, and attach or delete.

## Storage: a small table

Images use their own table, not columns on `transactions`:

```
transaction_images (id, budget_id, transaction_id, r2_key, content_type, byte_size, file_name, created_at,
                    deleted_at, object_deleted_at)
unique (transaction_id) where deleted_at is null      -- one live image per transaction
index (budget_id) where deleted_at is not null and object_deleted_at is null   -- the sweep
```

Why not columns:
- **Copies.** Columns would ride every whole-row copy of a transaction. The bulk duplicate copies split lines with
  `...l`, and edits spread `...before`. A copied key would make two rows own one object, so deleting either image
  would break the other.
- **Undo.** The undo engine reads image writes logged as a `transaction` update, ignores the unmapped keys, and
  reports a successful undo that changed nothing. A separate `transaction_image` entity is refused instead
  (`services/undo.ts`, unknown types).
- **Edits.** An attach would also move the transaction's `updated_at`, so an edit opened before it would fail its
  guard (`holdsAt`).

With a table, image writes never touch the transaction row.

**`has_image`** is a correlated `exists (… transaction_images … deleted_at is null)` labelled `has_image`. It is
selected in `detailSelect`, `listDetailForAccount` (both branches) and `listDetailForPlan`
(`repositories/transactions.ts`). It adds no statement, so the D1 call count of every read is unchanged. A counting
test runs the reads with 0, 1 and 50 images. `logShape` leaves `has_image` out, so change_log `transaction` rows do
not change.

**R2 key:** `transaction-images/<budget_id>/<transaction_id>/<32 hex characters from crypto.getRandomValues>`. It is
never returned by the API or written to change_log. The bucket has no public access, and every request passes
Access first.

## Writes

Each write follows the same steps:
1. One read batch: the plan, the live transaction (not a split line), its live image, and up to 20 sweepable rows.
2. The R2 work.
3. **One** `db.batch`, holding:
   - the sweep marks;
   - on a replace, the soft-delete of the previous row;
   - the guarded insert or soft-delete;
   - one `change_log` row.

The change_log row has `entity_type: "transaction_image"`, `entity_id` = the transaction id, action `create` (first
attach), `update` (replace) or `delete`, the caller's actor and the request's change set. Its before and after are the
`TransactionImage` shape or null.

If a guarded statement wrote nothing (the transaction was deleted meanwhile), the request answers 404. If the unique
index collides with a concurrent attach, it answers 409. Either way, the object just written is deleted.

## Objects and orphans

- **Attach.** The object is written before the batch, so a live row never points at a missing object. If the batch
  fails, the object is deleted again.
- **Replace and delete.** The batch soft-deletes the row first, then the old object is deleted. Deleting it first
  would leave a live row without bytes if the batch failed.
- **A failed object delete** leaves an orphan: a soft-deleted row with `object_deleted_at` null whose object is still
  in R2. Each later image write in the plan retries it as a sweep:
  - it deletes up to 20 such objects (an R2 delete of a missing key succeeds);
  - then it sets their `object_deleted_at` in its own batch, so a row is marked only after its object is gone.

  Because R2 does not report success back to D1 without another call, a normal delete's row is also only marked by a
  later sweep. That is harmless: the delete repeats as a no-op.
- **Deleted transaction (soft delete).** The image row and the object are kept. Undo of the delete brings the
  transaction back with `has_image: true`. These objects are not orphans: they belong to a row that can come back, and
  they are kept like the row itself.
- **Deleted plan (soft delete).** The plan's images are kept with its rows.
- **No cron sweep.** No path lists the bucket. Orphans come only from a failed R2 delete after a committed batch, and
  the next image write in that plan retries them.

## Interactions

| event | image |
|---|---|
| Transaction deleted (alone or in bulk) | Kept, with its object; undo restores it. GET/PUT/DELETE answer 404 while the transaction is deleted. |
| Split, edit of a split, un-split | Stays on the parent. The parent keeps its id, and split lines are new rows that cannot hold an image. |
| Transfer | Each side is its own row with its own image. |
| Duplicate (bulk) | Not copied: the copy has no image. |
| Move to another account | Kept: the row keeps its id. |
| Manual match | The hand entry survives and the import row is soft-deleted (`services/manual-match.ts`). An image on the import stays with that soft-deleted row and is not shown. Carrying it across to the hand entry is a follow-up. |
| Plan export | Not copied: the export holds no images. |
| Make a Fresh Start | Not copied: Fresh Start copies no transactions. The archive keeps its images. |
| Plan import | No images are imported. |
| Backup | The D1 backup dumps every table, so it includes `transaction_images` rows. The objects stay in `budget-files` and are not copied into the backup. |

## Undo

Attach and delete are **not** undoable:
- They are not in D5's recorded list (`docs/undo-design.md`), and the web hooks pass no `onChangeSet`.
- The change set is still written. Undoing it through the API answers 409 `undo_refused`, because the engine refuses
  unknown entity types.
- Fresh Start uses the same route.
- Because image writes do not touch the transaction row, Undo of an earlier transaction edit still works after an
  attach.

## Web

- `apps/web/src/api/transaction-images.ts`:
  - the upload is a raw `fetch` with `FormData`, because `apiFetch` sends JSON only;
  - the delete goes through `apiFetch`;
  - the download fetches a blob and saves it through `<a download>`, keeping the bytes unchanged, under the name the
    upload had (read from the response's `Content-Disposition`; `transaction-photo` when there is none);
  - after each write, the hooks invalidate the plan's queries.
- `register/ImageCell.tsx`, `register/ImageViewer.tsx`, `PhotoIcon` in `register/icons.tsx`.
- `register-view.tsx`'s `RegisterViewContext` gains `showImages`. `RegisterTable`, `EntryRow`, `PendingSection` and
  `ScheduledSection` add the column wherever they add the flag column, right after it.
- Styles are in `register/register-image.css`, not `register.css`. The column is 44px wide and the category column
  absorbs the difference. Colours come only from tokens in `shell/tokens.css` and `shell/theme-light.css`.
