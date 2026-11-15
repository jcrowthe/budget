# Profile completion: design

Complete `clone.profile.json` so the Deploy, Discover and Test-flow templates can load it, and add the
scripts its new keys name. No UI, no product feature, nothing under `apps/` changes.

## Source

There is no source behaviour to study: this Build has no UI (Lead's preflight card: skip the source app).
The "specification" is the brief, plus two failures it quotes:

- Deploy: `PROFILE_ERROR: … repo.deploy, repo.migrations_pending, health.version_field,
  live.auth_headers_from_env, live.recipes.{create,get,delete,purge,routes}, live.never_run (missing)`.
- Discover: `clone.profile.json has no source.driver`.

## Starting point (what is on the branch)

Commit `14df7ab` ("exfab: v_2", the intake draft) already edits every file in scope. Reviewed against the
brief and the code, it is a draft, not finished work. Defects found (each one is fixed by the spec):

| Where | Defect (evidence) |
|---|---|
| `clone.profile.json` | `live.deploy` was deleted (brief: keep it). `never_run[3]` and `never_touch[0]` do not use the brief's wording. Recipes do not say what each prints. `routes` does not list the real routes. |
| `scripts/live-test-plans.sh` | Reads `.data[]` / `.data.id`; the API answers `{data:{budgets:[…]}}` and `{data:{budget:{…}}}` (`apps/worker/src/routes/budgets.ts`), so `list` prints nothing and `create` prints an empty id. `((count++))` under `set -e` exits 1 on the first purge delete. Purge does not re-read a plan before deleting it. No HTTP status checks (a 403 or 404 is treated as success). Override variable is the generic `BASE_URL`, accepts any host, and the Access headers are sent to it whenever the two variables are set (brief: only on URLs under `live.url`). Without the override and without credentials it calls the live clone unauthenticated instead of refusing. No way to authenticate against the e2e server (`vite preview` needs a local JWT). Has extra `routes`/`delete_import` subcommands that duplicate profile text. |
| `scripts/migrations-pending.sh` | Parses `wrangler d1 migrations list` output as if it listed *applied* migrations (it lists the ones *to apply*). Discards stderr and treats any failure (bad token, network) as "database absent": prints every migration and exits 0, so it never reports "cannot tell". `wrangler.jsonc` has no `database_id` (deploy patches it in at build time), so the wrangler route cannot address the remote database anyway. |
| `scripts/deploy.sh` | `PHASE_SECONDS` values are "seconds since the phase started until the end", not each phase's duration, and the line is printed through `say` as `==> PHASE_SECONDS …`. An unknown `DEPLOY_PHASE` (e.g. `relase`) runs gate and release. In dry run, `pnpm check` and `pnpm e2e` print the same `DRY: gate`, so a test cannot tell that `DEPLOY_E2E=skip` skipped only Playwright. |
| `scripts/test/*` | `live-test-plans.test.ts` never talks to a server (brief requires the local server). `profile.test.ts` checks a hard-coded script list instead of every script a profile value names, and does not check that today's keys survive. No test for `migrations-pending.sh`. |
| `docs/conventions.md` | Documents the removed subcommands; no override/local-auth usage. |

Verified unchanged: `git diff 2d82719 HEAD -- apps scripts/lib` is empty. The required-variable check
(`need …`) already runs before the phase branch.

## Approach

Keep the draft's file layout; fix the defects. Everything stays bash + `jq` + `curl` (already required by
`deploy.sh`) and vitest tests in `scripts/test/` (already run by `pnpm check` through the `scripts` project
in `vitest.config.ts`).

### 1. `clone.profile.json`

Add exactly the keys of the brief; keep every key that exists at `2d82719` (including `live.deploy`,
`live.access`, `live.deploy_env`, `live.source_test_space`, `health.dev_url`, `ports`, `box`). Final values
are in the spec, §T1. Two choices worth naming:

- **Recipes carry what they print as a trailing shell comment**: `bash scripts/live-test-plans.sh list  #
  prints …`. The value stays a runnable one-line command (the comment is inert in any shell) and an agent
  reading it learns the output format. *Inferred* (the brief says "one-line commands, with what each
  prints"; the template format is unseen).
- **`live.recipes.routes`** lists the routes that exist today, read from `apps/worker/src/app.ts` and
  `apps/worker/src/routes/*.ts`: reads `GET /api/v1/health`, `GET /api/v1/openapi.json`,
  `GET /api/v1/budgets`, `GET /api/v1/budgets/{id}`; writes `POST /api/v1/budgets`,
  `PATCH /api/v1/budgets/{id}`, `DELETE /api/v1/budgets/{id}`.

`health.version_field = deploy_sha`: `routes/health.ts` returns `c.env.DEPLOY_SHA`, which `deploy.sh` sets to
`git rev-parse HEAD` (full 40-char sha). No app change is needed.

### 2. `scripts/deploy.sh` phases

```
need <7 vars>  →  tools  →  validate DEPLOY_PHASE ∈ {unset/empty, gate, release} (else exit 2)
DEPLOY_PHASE != release : gate    = checks (pnpm check) ; e2e (pnpm e2e, or 0 s when DEPLOY_E2E=skip)
                                    print  PHASE_SECONDS checks=<s> e2e=<s>
DEPLOY_PHASE != gate    : release = build ; resources (D1/R2, bookmark, Access, DNS) ; migrations ;
                                    deploy ; smoke
                                    print  PHASE_SECONDS build=<s> resources=<s> migrations=<s> deploy=<s> smoke=<s>
                                    print  Live: https://budget.doxen.dev   and   DEPLOY_SHA=<full sha>
```

- `PHASE_SECONDS` lines start at column 0 (plain `echo`, no `==> `), one per finished phase, each value
  the duration of that sub-step. A failed phase prints no `PHASE_SECONDS` line. *Inferred*: the template
  greps a line starting with `PHASE_SECONDS`. Sub-step names beyond the brief's example: `resources`
  (added so `migrations` measures only the migration apply).
- Dry run prints `DRY: gate: pnpm check` and `DRY: gate: pnpm e2e` (the substring `DRY: gate` keeps
  `deploy.test.ts` valid).
- `DEPLOY_E2E=skip` is honoured only in the gate; any other value runs Playwright.
- `DEPLOY_PHASE=gate` calls nothing in Cloudflare (no `cf_api`, no wrangler, no build): the whole release
  block is skipped.
- `DEPLOY_PHASE=release` runs no `pnpm check` / `pnpm e2e`. *Inferred*: the template runs it on the same
  checkout right after the gate passed.

### 3. `scripts/migrations-pending.sh` (read-only)

Uses the Cloudflare REST API through `scripts/lib/cf.sh` (`cf_api`: token on a pipe, never argv), not
wrangler (no `database_id` in `wrangler.jsonc`):

1. `need CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID` (exit 2, names the missing ones). `unset
   DEPLOY_DRY_RUN` so `cf_api` never fakes answers here.
2. Local list: `*.sql` in `paths.migrations.dir` (read from the profile), sorted by name.
3. `GET /accounts/<acct>/d1/database?name=budget-db` → uuid of the exact name `budget-db`. None → print every
   local migration, exit 0.
4. `POST /accounts/<acct>/d1/database/<uuid>/query` with `{"sql":"SELECT name FROM d1_migrations ORDER BY
   id"}` (a SELECT; `never_run` allows it). Error containing `no such table` → every local migration is
   pending, exit 0. Any other error → message on stderr, nothing on stdout, exit 1.
5. Print each local file name not in the applied set, one per line; exit 0.

*Inferred*: output is bare file names (`20261115000200_idempotency_keys.sql`), the template counts lines.
Wrangler's default table `d1_migrations` with column `name` holding the file name is assumed
(`wrangler.jsonc` sets no `migrations_table`).

### 4. `scripts/live-test-plans.sh`

```
bash scripts/live-test-plans.sh list            → "<id>\t<name>" per test plan; nothing when none
bash scripts/live-test-plans.sh create '<name>' → "<id>"
bash scripts/live-test-plans.sh delete <id>     → "deleted <id>"
bash scripts/live-test-plans.sh purge           → "deleted <n> remaining <m>"
```

- **Prefix** from `live.test_prefix`; match is a literal string prefix (`jq startswith`, bash
  `[[ $n == "$P"* ]]`), never a regex.
- **Target**: default `live.url` from the profile. Override `LIVE_TEST_PLANS_BASE_URL`, accepted only when it
  matches `^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$` (exit 2 otherwise). A specific name, not `BASE_URL`,
  so a stray variable from another tool cannot redirect it.
- **Auth, live**: requires `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (exit 2 naming the missing
  ones, before any request); sends them as `CF-Access-Client-Id` / `CF-Access-Client-Secret` through
  `curl -K <(printf …)`, built per request.
- **Auth, local**: never sends the Access headers, even if the variables are set. `pnpm dev` (vite serve)
  signs requests itself (`apps/web/dev/local-access.ts`), so no auth is needed. For the e2e server
  (`vite preview`, no dev plugin), `LIVE_TEST_PLANS_LOCAL_JWT=1` signs a token with `node
  scripts/local-jwt.mjs --out <0600 temp file>` and sends it as `Cf-Access-Jwt-Assertion` through a curl
  config on a pipe; the temp dir is removed on exit. `LIVE_TEST_PLANS_LOCAL_JWT` without the override → exit 2.
- **HTTP**: every request checks the status (`-o <tmp> -w '%{http_code}'`, `--max-time 30`); an unexpected
  status → `ERROR: <METHOD> <path> answered <status>` on stderr, exit 1. Response bodies are never printed
  raw.
- **Never prints** a secret, the token, or the name of a plan without the prefix (refusals name the id only).
- **Refusals before any network call**: unknown command, missing arg, `create` name without prefix,
  `delete` id that is not a UUID → exit 2.
- **delete**: GET `/api/v1/budgets/<id>`: 404 → `ERROR: no plan <id>`, exit 1; name without prefix →
  `REFUSED: plan <id> is not a test plan`, exit 3; else DELETE (expect 200), print `deleted <id>`.
- **purge**: list prefixed ids; more than 50 → `REFUSED: <k> test plans match (limit 50); nothing deleted`,
  exit 3. For each: re-read (404 → skip; name no longer prefixed → skip), DELETE, count. Re-list; print
  `deleted <n> remaining <m>`; exit 0 only when m = 0, else 1.

Exit codes: 0 ok, 1 runtime/HTTP error or purge left plans, 2 usage/input refused, 3 target refused.

## Downstream effects

- Deploy can load the profile; its two-step run maps onto `DEPLOY_PHASE=gate` then `release`.
- Discover children get `source.driver = cdp`.
- Flow-test children manage `ZZ-TEST` plans only through `scripts/live-test-plans.sh`.
- `scripts/deploy.sh` is in `paths.sensitive`: the Reviewer should read the diff with that in mind. Release
  steps themselves are not reordered or changed; only phase gating, timing and dry-run labels.

## Out of scope

Anything under `apps/`, `scripts/lib/**` (incl. `access.sh`, `cf.sh`), running a real release or touching
Cloudflare, GitHub Actions, MCP, the README's docs text.

## Acceptance

All cases run locally; none needs the source app or the live clone. "Sentinels" = the seven
`live.deploy_env` variables set to distinct fake values (as in `scripts/test/deploy.test.ts`).

1. **Profile keys.** `pnpm exec vitest run --project scripts scripts/test/profile.test.ts` passes. Removing
   any key the brief lists (e.g. `jq 'del(.live.recipes.purge)'`) makes it fail naming that key path.
2. **Profile values.** In `clone.profile.json`: `repo.deploy = "bash scripts/deploy.sh"`, `live.deploy`
   still present, `repo.deploy_phases = true`, `health.version_field = "deploy_sha"`, `source.driver = "cdp"`,
   `live.health_path = health.path`, `auth_headers_from_env` equals the brief's map; `never_run` and
   `never_touch` contain the brief's lines verbatim; no value in the file is a credential.
3. **Scripts named by the profile exist.** Every `scripts/<file>.{sh,mjs}` mentioned anywhere in the profile
   exists in the repo (test fails if a value names a missing script).
4. **Gate changes nothing.** `DEPLOY_DRY_RUN=1 DEPLOY_PHASE=gate` + sentinels: exit 0; output has
   `DRY: gate: pnpm check`, `DRY: gate: pnpm e2e`, a line `PHASE_SECONDS checks=<n> e2e=<n>`; it has none of
   `Build `, `Resources:`, `DRY: POST`, `DRY: PUT`, `DRY: DELETE`, `DRY: wrangler`, `Live:`, `DEPLOY_SHA=`.
5. **Release runs no gate.** `DEPLOY_DRY_RUN=1 DEPLOY_PHASE=release` + sentinels: exit 0; no `DRY: gate`;
   build → resources → Access → DNS → migrations → deploy → smoke in order; a line
   `PHASE_SECONDS build=<n> resources=<n> migrations=<n> deploy=<n> smoke=<n>`; `Live: https://budget.doxen.dev`;
   `DEPLOY_SHA=` followed by `git rev-parse HEAD` (40 hex).
6. **E2E skip.** `DEPLOY_DRY_RUN=1 DEPLOY_E2E=skip` with `DEPLOY_PHASE` unset and with `gate`: output has
   `DRY: gate: pnpm check`, lacks `DRY: gate: pnpm e2e`, `PHASE_SECONDS` gate line has `e2e=0`; unset phase
   still reaches `DEPLOY_SHA=`.
7. **Required variables in every phase.** For `DEPLOY_PHASE` ∈ {unset, `gate`, `release`} with sentinels minus
   `CF_ACCESS_CLIENT_SECRET`: exit 2, stderr `Missing required environment variable: CF_ACCESS_CLIENT_SECRET`,
   and no `Gate`, `Build`, `DRY:` in the output.
8. **Unknown phase.** `DEPLOY_PHASE=relase` + sentinels + dry run: non-zero, stderr names the allowed
   values, nothing ran (no `DRY:`).
9. **No leak.** In cases 4–8 no sentinel value appears in stdout or stderr.
10. **Unchanged default.** `scripts/test/deploy.test.ts` passes (order and no-leak cases).
11. **Pending migrations, fake API.** With a fake `curl` first on `PATH`: database absent → prints the three
    files of `apps/worker/migrations` in order, exit 0; `no such table` → same; first two applied → prints
    only `20261115000200_idempotency_keys.sql`; all applied → empty stdout, exit 0; API error → empty stdout,
    message on stderr, exit 1; `CLOUDFLARE_API_TOKEN` unset → exit 2 naming it. The token sentinel never
    appears in curl's argv nor in the output.
12. **Test plans, local server** (`pnpm dev`-equivalent vite server on a free port with its own state dir;
    script run with `LIVE_TEST_PLANS_BASE_URL=http://127.0.0.1:<port>`). Seed an unprefixed plan `Keep me`
    with a direct `POST /api/v1/budgets`.
    - a. `create 'Not a test'` → exit 2, stderr mentions `ZZ-TEST`; plan count unchanged.
    - b. `create 'ZZ-TEST one'` → stdout is exactly one UUID line; `GET /api/v1/budgets/<id>` → 200.
    - c. `list` → has `<id>\tZZ-TEST one`; contains neither `Keep me` nor its id.
    - d. `delete <keep-id>` → exit 3; output lacks `Keep me`; the plan still answers 200.
    - e. `delete <zz-id>` → `deleted <zz-id>`; GET → 404.
    - f. create three `ZZ-TEST p<i>`; `purge` → `deleted 3 remaining 0`, exit 0; `Keep me` still 200.
    - g. create 51 `ZZ-TEST bulk<i>` directly; `purge` → exit 3, stderr has `limit 50`; still 51 prefixed.
13. **Test plans, auth routing** (header-capturing local HTTP server answering `{data:{budgets:[]}}`):
    with the override and sentinel `CF_ACCESS_CLIENT_*` set, `list` sends no `cf-access-client-*` header;
    with `LIVE_TEST_PLANS_LOCAL_JWT=1` it sends `cf-access-jwt-assertion`; output never contains the
    sentinels or the token.
14. **Test plans, live mode** (fake `curl` on `PATH`, no override, sentinel credentials): `list` calls
    `https://budget.doxen.dev/api/v1/budgets`, passes `-K`, the sentinels are not in argv and the config it
    read has both header lines. Without credentials: exit 2 naming both variables, curl never invoked.
    Override `https://example.com` → exit 2, curl never invoked.
15. **Nothing else changed.** `git diff 2d82719 -- apps scripts/lib` is empty; no file outside the Manifest
    changed.
16. **Gates.** `pnpm check` and `pnpm e2e` pass.

## Manifest

touches: [clone.profile.json, scripts/deploy.sh, scripts/migrations-pending.sh, scripts/live-test-plans.sh, scripts/test/**, docs/conventions.md, docs/profile-completion-design.md, docs/profile-completion-spec.md, docs/README.md]
shared: []
migrations: 0
