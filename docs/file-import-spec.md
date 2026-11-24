# File import, Worker API: spec (FI-2)

Design: [file-import-design.md](file-import-design.md), "Worker (FI-2)". Tickets: EXF-531 (server side), EXF-518 on file
import, EXF-515 AC6. Every item below is a test in `apps/worker/test/`; the run that went red on base (route 404) is kept
with the build.

| # | What | Test |
|---|------|------|
| 1 | Preview: format, labels, mapping 0–4, `remember`, two rows as `buildFileRows` gives; 404, `unsupported_format`, 413 | `file-import-preview.test.ts` |
| 2 | EXF-531 AC6: `{2, 0, 0}`, cleared, unapproved, `source "file"`, `file:v1:` keys, attention counts, `?needs=`, Payroll inflow to Ready to Assign, the cafe row uncategorised | `file-import.test.ts` › "file import (EXF-531 AC6)" |
| 3 | Worked example: `{2, 1, 0}`, cleared 755.50, uncleared −260.00, working 495.50, Ready to Assign +250.00, Corner Market merged | `file-import.test.ts` › "worked example" |
| 4 | Re-import: `{0, 3, 0}`, no new row or change_log row (the same stored file, and a fresh preview) | `file-import.test.ts` › "re-import" |
| 5 | Cutoff: 1 imported and 1 skipped; `include_before_start` imports 2 and moves the Starting Balance with a log row | `file-import.test.ts` › "the cutoff" |
| 6 | EXF-515 AC6: history Groceries, fixed Fun, new payee none | `file-import.test.ts` › "payee defaults on import" |
| 7 | EXF-518 AC1, AC5: the six rows, a merged row keeps its payee and has no `rename_rule_id`, rule rows carry it | `file-import.test.ts` › "renaming rules on import" |
| 8 | EXF-518 AC4: a POST keeps `XX PHONECO 99` | `file-import.test.ts` › "EXF-518 AC4" |
| 9 | Tombstones: a rejected or deleted imported row stays out and counts as matched | `file-import.test.ts` › "tombstones" |
| 10 | A bank-synced row with the same date and amount makes the file row skip | `file-import.test.ts` › "a Direct Import duplicate" |
| 11 | OFX: FITID keys; a memo edit adds nothing | `file-import.test.ts` › "OFX" |
| 12 | D1 calls (preview 2, import 4 for 10, 100 and 1,000 rows), 7 batch statements for 100 and 1,000 rows, 2,001 rows give 422 and write nothing, a failing last statement rolls back | `file-import-calls.test.ts` |
| 13 | change_log: creates, merges, the Starting Balance move, the settings row, with the caller's actor | `file-import.test.ts` › "change_log"; `file-import-mcp.test.ts` (actors) |
| 14 | MCP parity with REST (by `file_id` and by content), the surface, coverage, descriptions and timestamps | `file-import-mcp.test.ts`, `mcp-coverage`, `mcp-descriptions`, `mcp-timestamps` |
| 15 | R2: one object per preview; 410 after 30 days; the next preview sweeps it (5 at most), a swept id still answers 410 | `file-import-store.test.ts` |
| 16 | Gates: `pnpm install --frozen-lockfile && pnpm check`, one full `pnpm e2e` | the build's run |
