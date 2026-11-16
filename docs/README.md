# Docs

One line per design doc, appended by each Build (merge=union).

- [Scaffold design](scaffold-design.md): the skeleton, Access, secrets, the plans slice, shell, deploy (spec: [scaffold-spec.md](scaffold-spec.md))
- [Conventions](conventions.md): how a feature Build adds a resource end to end (files, shared modules, product rules)
- [Scaffold polish](scaffold-polish.md): Designer polish list for the shell, with applied status
- [Profile completion design](profile-completion-design.md): clone.profile.json keys for Deploy, Discover and Test-flow; deploy phases, migrations-pending and live-test-plans scripts (spec: [profile-completion-spec.md](profile-completion-spec.md))
- [Worker hardening design](worker-hardening-design.md): EXF-453 HKDF secrets key, Worker-side Access identity pin, idempotency retry tests (spec: [worker-hardening-spec.md](worker-hardening-spec.md))
- [Source URL design](source-url-design.md): EXF-458 source.url points at the Test Budget plan; profile test pins it; source check matches by host (spec: [source-url-spec.md](source-url-spec.md))
- [Budget engine design](budget-engine-design.md): EXF-485 month read model (Assigned/Activity/Available, rollover, Ready to Assign), core tables, write services, months REST + get_plan_month (spec: [budget-engine-spec.md](budget-engine-spec.md))
- [Plan URLs design](plan-urls-design.md): EXF-475 plan-scoped URLs, page titles, browser history, `last_opened_at` via PATCH `opened` (spec: [plan-urls-spec.md](plan-urls-spec.md))
- [Targets engine design](targets-engine-design.md): EXF-511 targets table, setTarget/deleteTarget services, pure target arithmetic (needed, funded, to go, status, percent) on the month read model (spec: [targets-engine-spec.md](targets-engine-spec.md))
- [Test surface design](test-surface-design.md): EXF-561 API path and MCP tool tests derived from the route/tool globs; a new resource never edits openapi.test.ts, mcp.test.ts or e2e/mcp.spec.ts (spec: [test-surface-spec.md](test-surface-spec.md))
- [Plan grid design](plan-grid-design.md): EXF-487 Plan month grid (toolbar, groups, categories, pills, progress bars, local collapse/progress-bar state) and default categories for new plans (spec: [plan-grid-spec.md](plan-grid-spec.md))
- [Accounts design](accounts-design.md): EXF-481 accounts REST + MCP, Add Unlinked Account with a Starting Balance, race-safe unique names, sidebar account list, minimal account page (spec: [accounts-spec.md](accounts-spec.md))
- [Accounts polish](accounts-polish.md): Designer polish list for the accounts screens, with applied status
- [Assigned inline design](assigned-inline-design.md): EXF-489 editable Assigned cell (typing, arithmetic, Enter/Tab/arrows/Escape), optimistic month cache, PATCH `/budgets/{budget_id}/months/{month}/categories/{category_id}` and MCP `set_assigned` (spec: [assigned-inline-spec.md](assigned-inline-spec.md))
- [Sidebar groups design](sidebar-groups-design.md): EXF-483 typed sidebar account groups (STARRED, CASH, CREDIT, LOANS, TRACKING, CLOSED) with totals and collapse, derived account `group` in REST/MCP, `ui-state` resource (spec: [sidebar-groups-spec.md](sidebar-groups-spec.md))
- [Sidebar groups polish](sidebar-groups-polish.md): EXF-483 polish list
- [Month navigation design](month-nav-design.md): EXF-493 Plan header month arrows, month picker, Today, month note; PATCH months/{month} note, GET month-range facts, set_month_note (spec: [month-nav-spec.md](month-nav-spec.md))
- [Account register design](account-register-design.md): EXF-513 transactions REST + MCP (plain cases, derived updated_at, reconciled and credit Starting Balance refusals), account page register toolbar and sortable table, cleared toggle (spec: [account-register-spec.md](account-register-spec.md))
- [Account register polish](account-register-polish.md): Designer polish list for the account register, with applied status
- [Bank connections design](bank-connections-design.md): EXF-459 Plaid credentials in D1, per-plan `bank_environment` (sandbox/production), institution search and Popular Options, Plaid Link from Add Accounts, `bank-connections` + `bank_accounts`, `/plaid/oauth`, MCP `list_bank_connections` (spec: [bank-connections-spec.md](bank-connections-spec.md))
