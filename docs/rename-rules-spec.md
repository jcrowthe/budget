# Payee renaming rules (EXF-467): implementation spec

Design: [rename-rules-design.md](rename-rules-design.md). Commit after each task, in order. Verify with `pnpm exec
vitest run <files>` or `pnpm e2e <specs>`; `pnpm check` before each commit; never the whole browser suite, never
the source app, no sub-agent. The five EXF-881 files are not needed.

## Words (constants in `packages/schema/src/rename-rules.ts`)

```ts
export const RENAMING = {
  title: "Renaming",
  intro: "Imported payees that match these rules will be renamed.",
  contains: "Contains", is: "Is",
  remove: "Remove renaming rule", add: "Add a renaming rule",
  listIcon: "Renaming rules applied",
  severalNote: "One or more of these payees have renaming rules. Deleting them will also delete their rules.",
  bankImport: "Bank Import Details",
  statement: "As it appears on your statement",
  imported: "As we imported it",
  dontRename: (payee: string) => `Don't rename as ${payee}`,
  importedAs: (payee: string, imported: string) => `${payee} (Imported as ${imported})`,
} as const;
export const RENAME_RULE_ERRORS = {
  empty: "Renaming rule text cannot be empty",
  tooLong: "Renaming rule text can be at most 200 characters",
  noField: "Give kind or text",
  duplicate: "This payee already has this renaming rule",
} as const;
```

## Task 1: migration, table, repository, matching

**`apps/worker/migrations/20261116101800_payee_rename_rules.sql`** (exactly this name; delete `.e2e-state` after):

```sql
-- EXF-467: renaming rules of a plan's payees. match_text is the folded form the Worker compares (foldRuleText).
CREATE TABLE payee_rename_rules (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  payee_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  match_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX payee_rename_rules_payee ON payee_rename_rules (payee_id, kind, match_text) WHERE deleted_at IS NULL;
CREATE INDEX payee_rename_rules_budget ON payee_rename_rules (budget_id, kind, match_text) WHERE deleted_at IS NULL;
```

**`apps/worker/src/db/schema/payee-rename-rules.ts`**: `payeeRenameRules` with the same columns (`kind: text("kind",
{ enum: RENAME_RULE_KINDS })`), `uniqueIndex(...).where(sql\`deleted_at IS NULL\`)` and `index(...).where(...)` as in
`db/schema/payees.ts`. Verify: `apps/worker/test/schema-drift.test.ts`.

**`packages/schema/src/rename-rules.ts`** (import `z` from `@hono/zod-openapi`):

```ts
export const RENAME_RULE_KINDS = ["contains", "is"] as const;
export type RenameRuleKind = (typeof RENAME_RULE_KINDS)[number];
export const RENAME_RULE_TEXT_MAX = 200;
export function foldRuleText(s: string): string; // s.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase()
/** The text as stored: trimmed; throws nothing, returns the error key or the text. */
export function checkRuleText(s: string): { ok: true; text: string } | { ok: false; error: "empty" | "tooLong" };
export interface MatchableRule { id: string; payeeId: string; kind: RenameRuleKind; matchText: string; createdAt: string }
/** The winning rule for an imported name, or null: `is` (equal) before `contains` (substring), newest, greater id. */
export function pickRenameRule<R extends MatchableRule>(name: string | null, rules: readonly R[]): R | null;
export const PayeeRenameRule = z.object({ id, payee_id, kind: z.enum(RENAME_RULE_KINDS), text, created_at, updated_at }).openapi("PayeeRenameRule");
export const RenameRuleCreate = z.object({ kind: z.enum(RENAME_RULE_KINDS), text: z.string() }).openapi("RenameRuleCreate");
export const RenameRuleUpdate = z.object({ kind: z.enum(...).optional(), text: z.string().optional() }).openapi("RenameRuleUpdate");
export const RenameRuleIdParam;              // { budget_id, payee_id, rule_id } path params
export const RenameRuleResponse = dataEnvelope(z.object({ rule: PayeeRenameRule }));
export const RenameRuleListResponse = dataEnvelope(z.object({ rules: z.array(PayeeRenameRule) }));
```

Length is checked on the trimmed text (the zod schema does not `max()` it, so the service gives the words).

**`packages/schema/test/rename-rules.test.ts`**: fold (case, runs of spaces, NFC: `"Café"` vs `"Café"`,
`CAFÉ`/`café` equal, `STRASSE` ≠ `straße`); `is` whole name only; `contains` substring, order (`uber eats` does not
match `EATS UBER`), no wildcards (`*` is a plain character); OR of a payee's rules; `is` beats a newer `contains`;
same kind: newest `createdAt`, then greater `id`; `null` name → null; `checkRuleText` (`"  "` empty, 201 chars
tooLong, 200 ok, trimmed).

**`apps/worker/src/repositories/payee-rename-rules.ts`** (reads, and unexecuted `*Stmt` functions):

```ts
export type RuleRow = typeof payeeRenameRules.$inferSelect;
export function listForPayee(db, budgetId, payeeId): Promise<RuleRow[]>;           // live, order created_at, id
export function findLive(db, budgetId, payeeId, ruleId): Promise<RuleRow | undefined>;
export function rulesForPlanQuery(db, budgetId);  // unexecuted; live rules of live ordinary payees
export function insertStmt(db, row: RuleRow, guard: SQL);                            // insertSelect … where <guard>
export function updateStmt(db, ruleId, set: {kind?, text?, matchText?}, now, before: RuleRow); // guarded on before
export function softDeleteStmt(db, ruleId, now, before: RuleRow);
/** Insert unless (payee, kind, match_text) is live, while `cond` holds; and its history row (logSelect or changeLogInsertIf). */
export function addIfMissingStmts(db, base: LogBase, row: RuleRow, cond: SQL): [log, insert];
/** History rows and soft delete of every live `is` rule with that match_text in the plan whose payee is not `keep`. */
export function removeIsRulesStmts(db, base, budgetId, matchText, keepPayeeId: string | SQL, cond: SQL): [log, update];
/** History rows and soft delete of every live rule of the payees. */
export function removeForPayeesStmts(db, base, budgetId, payeeIds: readonly string[], cond: SQL): [log, update];
/** Conditions over stored match_text and a folded parameter (the same definition as pickRenameRule). */
export function containsMatchSql(budgetId, folded: string, exceptPayeeId: string | SQL): SQL; // exists … instr(?, match_text) > 0, payee live ordinary
export function hasRuleSql(payeeId: string | SQL, kind, matchText): SQL;
export function isUniqueViolation(e: unknown): boolean;  // "UNIQUE constraint failed: payee_rename_rules"
export const ruleLog = (r: RuleRow) => ({ id, payee_id, kind, text }); // change_log before/after
```

Every insert names its columns (`insertSelect` or `.values`). Rule history: `entity_type` `payee_rename_rule`,
`entity_id` the rule id; `create` (after = `ruleLog`), `update` (before/after), `delete` (before, after null).

A Worker test (`rename-rules.test.ts`, task 2) runs `containsMatchSql` / `hasRuleSql` against D1 for the unit
table's `is`/`contains` cases and asserts the same answers as `pickRenameRule`.

## Task 2: operations, tools, `has_rules`, delete

**`apps/worker/src/services/payee-rename-rules.ts`**:

```ts
export function ruleToApi(r: RuleRow): PayeeRenameRule;
export async function listRenameRules(env, budgetId, payeeId): Promise<PayeeRenameRule[]>;          // 3 D1
export async function createRenameRule(env, actor, budgetId, payeeId, input: {kind, text}): Promise<PayeeRenameRule>; // 3 D1
export async function updateRenameRule(env, actor, budgetId, payeeId, ruleId, input: {kind?, text?}): Promise<PayeeRenameRule>; // 4 D1
export async function deleteRenameRule(env, actor, budgetId, payeeId, ruleId): Promise<PayeeRenameRule>; // 4 D1
```

- The payee comes from the same check as `pathPayee` (`services/payees.ts`): transfer prefix → 403
  `PAYEE_ERRORS.transfer`; missing → `NotFound("Payee")`; system → 403 `PAYEE_ERRORS.system`. Export `pathPayee`
  and `requirePlan` from `services/payees.ts` (or move them) rather than copying. Refusals are `PayeeRefused`.
- Create: `checkRuleText` → 422; batch `[changeLogInsertIf(log, guard), insertStmt(row, guard)]` with guard =
  `liveOrdinarySql(budgetId, payeeId)`; a unique violation → 409 `duplicate`; 0 rows inserted → 404 Payee.
- Update: no field → 422 `noField`; unchanged kind and fold → return as is, no write; otherwise
  `[log, updateStmt]` guarded on the rule as read and the payee live; unique violation → 409; 0 changes → 409
  `PAYEE_ERRORS.race`. `text` is stored trimmed; `created_at` never changes.
- Delete: `[log, softDeleteStmt]`; answer the rule as it was.

**`apps/worker/src/routes/payee-rename-rules.ts`**: `export default` an `OpenAPIHono<AppEnv>` with the same
`defaultHook` and `refusals` pattern as `routes/payees.ts`, tags `["Payees"]`, paths
`/budgets/{budget_id}/payees/{payee_id}/rename-rules` (GET, POST → 201) and
`/budgets/{budget_id}/payees/{payee_id}/rename-rules/{rule_id}` (PATCH, DELETE); responses 200/201, 403, 404, 409,
422. Writes accept `Idempotency-Key` like the other writes (nothing to do if the middleware handles it).

**`apps/worker/src/mcp/tools/payee-rename-rules.ts`**: `export const tools: McpToolDef[]` with
`list_payee_rename_rules {budget_id, payee_id}`, `create_payee_rename_rule {budget_id, payee_id, kind, text}`,
`update_payee_rename_rule {budget_id, payee_id, rule_id, kind?, text?}`, `delete_payee_rename_rule {budget_id,
payee_id, rule_id}`; ids `Id`, `kind` `z.enum(RENAME_RULE_KINDS)`; descriptions: `Returns { rules }` / `{ rule }`
with its fields, how matching works (design), the tool errors, `timestamps(["created_at", "updated_at"])`.

- `apps/worker/test/mcp-coverage/payees.ts`: four lines (`"GET /budgets/{budget_id}/payees/{payee_id}/rename-rules":
  { tool: "list_payee_rename_rules" }`, POST create, PATCH `…/{rule_id}` update, DELETE `…/{rule_id}` delete).
- `apps/worker/test/mcp-timestamps.test.ts`: CALLS entries after `bulk_update_payees`: create on `c.payee`, then
  list, update (`rule_id` from `results.get("create_payee_rename_rule").rule.id`), delete. Keep every other line.
- `mcp/tools/payees.ts` descriptions: `list_payees` names `has_rules`; `rename_payee`: renaming a payee whose old
  name came from a bank import also adds the rule `is <old name>` to it; `delete_payee`, `bulk_update_payees`
  (delete): the payee's renaming rules are deleted too.

**`has_rules`**: `packages/schema/src/payees.ts` `Payee` gains `has_rules: z.boolean()` (description: "True when the
payee has renaming rules"); `PayeeListRow` gains `hasRules`; `listForPlan` adds, under `counts`,
`exists (select 1 from payee_rename_rules r where r.payee_id = payees.id and r.deleted_at is null)` (else `0`);
`payeeToApi` maps it (default false); transfer entries `false`. `packages/schema/test/payees.test.ts` helper `p`
gains `has_rules: false` (departure 9).

**Delete**: `buildPayeeDeleteBatch` returns six statements: log, transactions move, scheduled move,
`...removeForPayeesStmts(db, {…base, entityType: "payee_rename_rule"}, budgetId, ids, guard)`, payees' soft delete
(still last; `applyToPayees` keeps reading `res[res.length - 1]`). Update its comment ("six").

**Tests** `apps/worker/test/rename-rules.test.ts` (helpers `rename-rules-helpers.ts`, importing the existing
helpers): design acceptance 1.4 and 4 (REST and MCP with actors and history; every refusal: `transfer:<id>`, system,
unknown payee or rule, `"  "`, 201 chars, PATCH `{}`, duplicates incl. `ZZ  cafe` vs `zz cafe`); PATCH keeps id and
`created_at`; `has_rules` (hidden included); `apiPaths()`/`listedToolNames()` include the new ones; 98 tools; the
SQL-predicate agreement test.

## Task 3: the import applies the rules (`services/plaid-sync.ts`)

- `planPayees`: keep `byName` (as today) and `byId: Map<id, {name, lastCategoryId}>` from the same `listForPlan`.
- In the per-account batch, after the `categoryNamesQuery` entries, push `rulesRepo.rulesForPlanQuery(db, id)` per
  plan; read them into `rulesOf: Map<budgetId, RuleRow[]>` (as `namesOf`).
- A helper `payeeFor(budgetId, bankName, rules, byId)` → `{ rule: RuleRow | null, payeeName, payeeIdSql, category
  source }`: with `rule = pickRenameRule(bankName, rules)` and its payee in `byId`: `payeeName` = that payee's name,
  `payeeIdSql` = `sql\`coalesce(${payeesRepo.liveOrdinaryIdSql(budgetId, rule.payeeId)}, ${ordinaryIdByNameSql(budgetId, bankName)})\``;
  else today's values. Add `liveOrdinaryIdSql(budgetId, id)` (scalar subquery) to `repositories/payees.ts`.
- **Insert path:** `newRow.payeeName` = `payeeName`; category via `categoryFor(kinds, amount, <rule payee's entry
  or byName.get(bankName)>)`; `addPayee(db, g, budgetId, bankName, now, guard')` where `guard'` = `guard` alone
  without a rule, and `allHold([guard, sql\`(select 1 where not ${liveOrdinarySql(budgetId, rule.payeeId)})\`])` with
  one; `insertIfStmt(..., payeeIdSql)`; `logPayeeIdStmt` takes the payee id SQL instead of the name (change its
  signature; both callers pass `payeeIdSql`). The create log's `after` is `{ ...logShape(...), rename_rule_id:
  rule.id }` when a rule applied. `importValues` unchanged: `importPayeeName` is the bank name.
- **Follow path:** `followPlan(budgetId, have, txn, pick)` with the same helper when `how === "follow"` and the
  bank name changed: `set.payeeName`, `set.payeeId = payeeIdSql`, `newPayee` (the bank name, created only under the
  "rule payee gone" guard when a rule applied); `followBank` logs `rename_rule_id` likewise.
- Matching with hand entries is untouched (a matched row keeps the hand payee).

**Tests** `apps/worker/test/rename-rules-sync.test.ts` (no file-wide timeout, a few rows each; rows from
`feed.pages = [{ added: [plaidTxn({...merchant_name})] }]` and `syncOne` / `runSync`): design acceptance 1.2,
1.3, 1.5, 1.6 with rules made through the API (1.1 needs task 4: it is in task 4's file); `import_payee_name` = bank name on a renamed row; the change_log `create` row has
`rename_rule_id` and actor `service:plaid`; a hidden payee's rule (payee stays hidden); a deleted payee's rule not
applied (the bank name payee is made); follow: an unapproved untouched import whose merchant changes to a name a
rule matches takes the rule's payee; acceptance 3 (an approved, edited row is not moved).
**Count** (`rename-rules-calls.test.ts`): the `link-status-calls.test.ts:22` world plus two rules on the plan →
`{ d1: 13, plaid: 2 }`.

## Task 4: rules made by themselves

**`services/transactions.ts` `mutate`** (single update only; `prepare` unchanged):

```ts
// after `plan` is built, kind === "update":
const imp = before.source === "plaid" ? (before.importPayeeName ?? null) : null;
const p = plan.after;
const learnOrUndo = imp !== null && !p.transferAccountId && p.payeeId && p.payeeId !== before.payeeId
  ? (p.payeeName === imp ? "undo" : "learn") : null;
```

Statements, built by `autoRuleStmts(db, { budgetId, actor, now, payeeId: p.payeeId, importName: imp, mode },
guard)` in `services/payee-rename-rules.ts`, folded = `foldRuleText(imp)`, `text` = `imp`:
- learn: `addIfMissingStmts(row on payeeId, cond = guard-exists)`.
- undo: `removeIsRulesStmts(folded, keep = payeeId, cond)`, then `addIfMissingStmts(row on payeeId, cond and
  containsMatchSql(budgetId, folded, payeeId))`.
Place them in the batch **after `w0.logs` and before `w0.rest`/`w0.self`** (the self write changes `updated_at`,
which `guard` rests on; a new payee's insert is in `w0.payees`, earlier). Keep `livePayeesCheck` first. The retry
loop rebuilds them. Export `TransactionDetail` gains `import_payee_name` (below).

**`services/payees.ts` `updatePayee`**: when `name !== row.name`, prepend to the batch
`addIfMissingStmts(db, base(actor, now), { payeeId: row.id, kind: "is", text: row.name, matchText:
foldRuleText(row.name), … }, allOf(same, sql\`exists (select 1 from transactions t where t.budget_id = ${budgetId}
and t.payee_id = ${row.id} and t.deleted_at is null and t.import_payee_name = ${row.name})\`))`. The payee's
update is then at index 3: read its change count there (not `res[1]`). Hide-only PATCH: nothing added.

**Transaction resource**: `packages/schema/src/transactions.ts` `Transaction` gains
`import_payee_name: z.string().nullable().default(null).openapi({ description: "The payee name the bank import
matched and its renaming rules compare, as received (the merchant name, else the name); null when no import gave
this transaction" })`; `transactionToApi` maps `row.importPayeeName ?? null`. Fixtures
`packages/schema/test/register.test.ts`, `register-export.test.ts` gain `import_payee_name: null` (departure 9).
`repositories/transactions.ts` needs no change unless a type asks for it.

**Tests** `apps/worker/test/rename-rules-auto.test.ts`: design acceptance 1.1 and 2.1–2.4. **2.1 is written first
and run against the code before the fix; the report quotes its failing line.** Also: learn by `payee_id` and by a
new `payee_name`; MCP `update_transaction` with an `mcp:` actor; split lines through `subtransactions`; Match and
Unmatch via `manual-match-helpers.ts`; history row per rule by the edit's actor; hide-only PATCH and a rename of a
payee with no imported row add nothing.
**Counts** (`rename-rules-calls.test.ts`): PATCH of an imported row's payee 8 (learn) and 8 (undo with a contains
rule elsewhere); `updatePayee` rename 4 with the rule made; `listPayees` 3 for 10 and 100 payees each with a rule;
rule list 3, create 3, update 4, delete 4; payee delete 3 and 4 (with replacement) for a payee with rules.

## Task 5: the card, the gear, the sentence

- **`apps/web/src/api/payees.ts`**: `listRenameRules`, `createRenameRule`, `updateRenameRule`, `deleteRenameRule`
  over `apiFetch` with the task 1 schemas (writes send an `idempotencyKey` like `updateTransaction`);
  `usePayeeRenameRules(b, id | null)` (`["payee-rename-rules", b, id]`, `enabled: id !== null`,
  `placeholderData: keepPreviousInPlan(b)`); `applyRuleChange(qc, b, payeeId, rules)` writes the rules list and
  that payee's `has_rules` (`rules.length > 0`) into `["payees", b]`; `VIEWS` gains `"payee-rename-rules"`.
- **`apps/web/src/payees/rename-rules-card.tsx`** `RenamingCard({ budgetId, payee, disabled })`: rendered by
  `EditPane` after `NameCard` for mode single ordinary (not transfer, not several); `key={payee.id}`. Markup: the
  `mp-card` frame; `<h2>` with `GearIcon` (aria-hidden) and `Renaming`; `<p className="mp-rules-intro">`; one
  `RuleRow` per rule (state: draft kind/text, error, pending) and one `NewRuleRow`. Behaviour:
  - Saved row: `<select aria-label="Rule type">` change → `updateRenameRule({kind})`; `<input aria-label="Rule
    text" maxLength={200}>` blur/Enter → if `trim()` differs from the saved text: empty → error
    `RENAME_RULE_ERRORS.empty` locally, else `updateRenameRule({text})`; Escape with a changed draft → restore and
    `stopPropagation` (as `NameCard`); `−` button (`title` and aria-label `RENAMING.remove`) → delete.
  - New row: default `contains`; blur/Enter with non-blank text → create; `+` button (`title`, aria-label
    `RENAMING.add`, `onMouseDown={e => e.preventDefault()}`) → create, or focus the input when blank; one request at a
    time (a ref, as `NameCard`'s `inflight`); success clears the row and keeps the focus in its input.
  - Error: `<div role="alert" className="mp-error">` under the row with `ApiError.detail`.
  - All row controls `disabled` while pending or when the pane is deleting.
- **`apps/web/src/payees/rename-rules-icons.tsx`**: `GearIcon` (16 px, `currentColor`, Budget's own path).
- **`manage-payees-list.tsx`**: before the checkbox of every payee row a `<span className="mp-rules-slot">`; with
  `p.has_rules` it holds `<span role="img" aria-label="Renaming rules applied" title="Renaming rules applied">
  <GearIcon/></span>`.
- **`manage-payees-pane.tsx`**: several mode, not deleting, `selected.some(p => p.has_rules)` →
  `<p className="mp-note">{RENAMING.severalNote}</p>` under the buttons.
- **`manage-payees.css`**: `.mp-rule-row` grid (select 104 px, input 1fr, button 28 px, gap 8), slot 16 px; tokens.
- **Spec `e2e/rename-rules-card.spec.ts`** (seed `e2e/support/rename-rules-seed.ts`: a plan through the API via
  `seedPayees` from `manage-payees-seed.ts` or its own `call`s, payees `ZZ Cafe`, `ZZ Other`, a hidden `ZZ Gone`;
  `openManagePayees` from `manage-payees-seed.ts`): design acceptance 5.1 at 1440×900 and the fit at 1024×700; each
  click `realClick`; after each save `expect.poll` the rules through the API.

## Task 6: tooltip, `Bank Import Details`, `Don't rename as`

- **`apps/web/src/register/RegisterTable.tsx`**, the non-transfer payee cell: when `tx.source === "plaid"`,
  render `<td data-field="payee"><span className="import-payee"><span className="import-payee-name"
  title={payeeTitle(tx)}>{tx.payee_name}</span><BankImportButton budgetId tx /></span></td>`; otherwise as today.
  `payeeTitle` (in `rename-rules-bank-import.tsx`): `RENAMING.importedAs(payee_name, import_payee_name)` when both
  are non-null and differ, else `payee_name ?? undefined`. Transfer cells and split lines unchanged.
- **`apps/web/src/register/rename-rules-bank-import.tsx`** `BankImportButton`: as `MatchCell`
  (`manual-match-details.tsx`): `Tooltip` content `Bank Import Details`, a button `className="bank-import-info"`,
  aria-label `Bank Import Details`, `aria-haspopup="dialog"`, `aria-expanded`, `InfoCircleIcon`; mouse events stop
  propagation; open → `Popover` (below, start, `role="dialog"`, label `Bank Import Details`, width
  `min(320, innerWidth − 16)`) with `<h2>`, two `<section>`s (`<h3>`, `<p>`), and when renamed the link button
  `RENAMING.dontRename(payee_name)` → `useSaveTransaction(budgetId).mutateAsync({ id: tx.id, body: { payee_name:
  tx.import_payee_name, approved: tx.approved } })`; success: close, focus the info button; failure:
  `<p role="alert">` with the detail. The portal wrapper stops click propagation (as `MatchCell`).
- **`register.css`**: `.import-payee` as `.transfer-payee`; `.bank-import-info` 22×22 as `.transfer-link`,
  `opacity: 0`, `1` under `tbody tr:hover`, `tr.is-checked`, `:focus-visible` (its ring) and while open; popover
  classes `bank-import-*` with the `match-panel` spacing.
- **Stand-in `e2e/support/rename-rules-stub.ts`** `stubRenameRulesImports(page, rows: { id, importPayeeName,
  bankDescription, importedPayee }[])`: GETs of `/transactions` lists only (as `manual-match-stub.ts`), dressed as
  the design's Acceptance preamble says (`import_id: "zz-imp-<id>"`); the PATCH goes to the real server. Its comment
  cites `services/transactions.ts:41-62`.
- **Spec `e2e/rename-rules-import.spec.ts`**: a plan through the API, a hand row with payee `ZZ Cafe` (dressed:
  `import_payee_name` `ZZ BANK CAFE 12`, statement `ZZ POS 4411 BANK CAFE 12`) and one with payee `ZZ Plain`
  (dressed, `import_payee_name` `ZZ Plain`); design acceptance 5.2–5.4: titles read from the element; hover with the
  real mouse shows the button; open by `realClick` and by Tab + Enter; the link's PATCH body captured with
  `page.waitForRequest` and the row's payee read by `expect.poll` through the API; reopen → no link. Run also
  `e2e/manual-match.spec.ts` and `e2e/manual-match-narrow.spec.ts` (their dressed imports now show the button).

## Checks before the gate

`pnpm check`; `pnpm e2e e2e/rename-rules-card.spec.ts e2e/rename-rules-import.spec.ts e2e/manage-payees.spec.ts
e2e/manual-match.spec.ts e2e/manual-match-narrow.spec.ts`. Report: D1 before/after (design "D1 calls"), tool count
98, each departure, "opened nothing in the source app".
