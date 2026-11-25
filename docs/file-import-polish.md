# File import UI: polish list (EXF-531, FI-4)

Status: **applied** in this build, **open** for a later pass, **n/a** not needed. Nothing was compared with the source
beyond the Thread's recorded observations (the contract's "Source facts"); the person's browser session was not used.

| # | Item | Status |
|---|------|--------|
| 1 | Dialog 1 and 2 close pattern: X titled "Close", Escape, Cancel; focus returns to the toolbar button | applied |
| 2 | Dialog widths 480 / 720 px, both capped to the window (`calc(100vw - 32px)`, `calc(100vh - 32px)`); the preview table scrolls inside dialog 2 (checked at 1024×700 and 1440×900) | applied |
| 3 | Colours from `shell/tokens.css` only (`--labelWarning` for the amber ⓘ and the skipped line) | applied |
| 4 | Dialog buttons use the shared `primary` / `secondary` classes (EXF-876) | applied |
| 5 | The date popover opens on a click of the ⓘ, closes with Escape before the dialog does | applied |
| 6 | The popover covers the first preview rows while open; it could anchor to the right of the Date label on a wide window | open |
| 7 | Account select of a long name: the header line wraps, the select shrinks (`max-width: 100%`) | applied |
| 8 | A file larger than 2 MB or with more than 2,000 rows is refused by the Worker; its words show in dialog 1 | applied |
| 9 | "Reading the file…" is plain text; a spinner could replace it for large files | open |
| 10 | The ▸ / ▾ caret is a text glyph; an SVG caret would not depend on the font | open |
| 11 | The import is not on the Undo stack (`apps/web/src/undo/**` was closed to this unit) | open (follow-up) |
| 12 | Learn More: left out (driver decision Q9) | n/a |

## Design pass (after review)

CSS only (`apps/web/src/file-import/file-import.css`), tokens from `shell/tokens.css`, no behaviour change.

| # | Item | Status |
|---|------|--------|
| 13 | Body bottom padding: the global `.dialog.form .form-body` zeroed it, so the help box and the "Include…" line touched the footer rule; now `--space-3` | applied |
| 14 | Close X in `--actionPrimary`, flush, as in the Plan Import / Export dialogs | applied |
| 15 | Date popover lifted with `--shadowMenu`; its Save takes the primary hover (`--actionPrimary`) | applied |
| 16 | Focus ring (`--actionPrimary`, 2px) on the amber ⓘ, the skipped toggle and Save | applied |
| 17 | Preview table: header in `--labelSecondary` with a rule under it that stays with the sticky row; cells 6px × `--space-2`; frame radius `--radius-md` like the selects | applied |
| 18 | A little air above the skipped note | applied |
