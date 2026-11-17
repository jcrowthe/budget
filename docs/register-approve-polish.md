# Register: approve, reject, attention and the banner (polish list)

Every item is "not compared: built from the ticket" (nothing was opened in the source app). Status is set by the
step that applies it.

| # | Item | Checked against | Status |
|---|---|---|---|
| 1 | Unapproved rows' text 600, approved 500 | EXF-463 "Register display" | built; `e2e/register-approve.spec.ts` |
| 2 | Attention column 24 px, header info icon, circled "i" in the accent colour on unapproved rows only | EXF-463 | built; header width asserted in `register-attention-narrow.spec.ts` |
| 3 | Pill: amber `rgb(218, 172, 0)`, text `rgb(54, 44, 5)`, 14 px, 600, 8 px sides, fully rounded; tooltip words | EXF-463 | built (`entry.css` also set 12 px: changed) |
| 4 | Banner above the account header, full width, accent background, info icon, count text, `View` at the right | EXF-463 | built; 40 px high, colours from tokens |
| 5 | Chip "Unapproved or Uncategorized" with a ×, same size as the flag pill | EXF-463 | built |
| 6 | Header cells clip with an ellipsis and carry their word in `title`; CATEGORY ≥ 88 px at 1024 px | EXF-728, EXF-760 | built; widths in the design |
