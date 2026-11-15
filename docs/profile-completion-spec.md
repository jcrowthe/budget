# Profile completion: implementation spec

Design: [profile-completion-design.md](profile-completion-design.md). The branch already holds the intake
draft (`14df7ab`); edit those files in place. Do not touch anything under `apps/` or `scripts/lib/`.
Keep all scripts `set -euo pipefail`, mode 755, and printing no environment-variable value.

## T1. `clone.profile.json`

Start from the current file. Result must keep every key present at `2d82719` (check with
`git show 2d82719:clone.profile.json | jq -c 'paths(scalars)'`) and set these values (others unchanged):

```jsonc
"repo": { …today's keys…,
  "deploy": "bash scripts/deploy.sh",
  "deploy_phases": true,
  "migrations_pending": "bash scripts/migrations-pending.sh" },
"health": { "dev_url": …, "path": "/api/v1/health", "version_field": "deploy_sha" },
"source": { …, "driver": "cdp" },
"live": {
  "url", "test_prefix", "test_space", "source_test_space": unchanged,
  "health_path": "/api/v1/health",
  "auth_headers_from_env": { "CF-Access-Client-Id": "CF_ACCESS_CLIENT_ID",
                             "CF-Access-Client-Secret": "CF_ACCESS_CLIENT_SECRET" },
  "auth": {
    "env": ["CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"],
    "headers": ["CF-Access-Client-Id", "CF-Access-Client-Secret"],
    "scripts": "Send CF-Access-Client-Id and CF-Access-Client-Secret (values from CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET) only on requests to URLs under live.url, through a curl config on a pipe (curl -K <(printf 'header = \"…\"\\n' …)), never argv; examples: scripts/live-test-plans.sh, the smoke test in scripts/deploy.sh",
    "browser": "scripts/access-browser.mjs: await attachAccess(context) adds the two headers only to requests whose hostname is budget.doxen.dev (the live origin); `node scripts/access-browser.mjs storage-state <out.json>` writes a CF_Authorization cookie storageState when Access issues one (exit 3 in strict service-token mode, then use attachAccess)"
  },
  "recipes": {
    "get": "bash scripts/live-test-plans.sh list  # prints one line per plan whose name starts with ZZ-TEST: <id><TAB><name>; nothing when none",
    "create": "bash scripts/live-test-plans.sh create '<name>'  # name must start with ZZ-TEST (else exit 2); prints the new plan's id only",
    "delete": "bash scripts/live-test-plans.sh delete <id>  # re-reads the plan, deletes it only if its name starts with ZZ-TEST (else exit 3); prints: deleted <id>",
    "purge": "bash scripts/live-test-plans.sh purge  # deletes every ZZ-TEST plan, re-reading each first; prints: deleted <n> remaining <m>; exit 0 only when m is 0; refuses (exit 3, deletes nothing) when more than 50 match",
    "delete_import": "Not applicable yet: the app has no imports.",
    "routes": "/ and every non-API path: the single-page app; /api/v1/*: REST, reads GET /api/v1/health, GET /api/v1/openapi.json, GET /api/v1/budgets, GET /api/v1/budgets/{id}, writes POST /api/v1/budgets, PATCH /api/v1/budgets/{id}, DELETE /api/v1/budgets/{id} (test plans are managed only through scripts/live-test-plans.sh); /mcp: the MCP endpoint"
  },
  "never_run": [
    "wrangler d1 execute --remote with any statement other than SELECT",
    "wrangler delete, wrangler d1 delete, wrangler r2 bucket delete, wrangler secret delete",
    "wrangler secret put or bulk outside scripts/deploy.sh",
    "wrangler d1 time-travel restore without the person's say-so",
    "any Cloudflare API call that creates, changes or deletes a resource not named for this app (Worker budget, D1 budget-db, R2 budget-files, Access applications budget and budget-mcp, Access policies budget-allow-owner and budget-service-auth, the DNS record named exactly budget.doxen.dev)",
    "anything that changes or deletes the wildcard DNS record *.doxen.dev",
    "scripts/deploy.sh with DEPLOY_PHASE=release or unset outside the Deploy template",
    "any Plaid call against the production environment that creates, updates or removes an Item"
  ],
  "never_touch": [
    "Cloudflare Workers, D1 databases, R2 buckets, Access applications, policies, service tokens and DNS records that are not named for this app (the account holds the person's other resources)",
    …the three entries of 2d82719, unchanged…
  ],
  "access": unchanged,
  "deploy": "bash scripts/deploy.sh",     // restore: the draft deleted it
  "deploy_env": unchanged
}
```

Verify: `jq . clone.profile.json >/dev/null`; T5 tests.

## T2. `scripts/deploy.sh`

Release steps, `cf_api`/`ensure_access` calls and the smoke test stay byte-for-byte as in the draft except
for the phase markers. Changes:

1. Header comment: document `DEPLOY_PHASE` (unset | `gate` | `release`), `DEPLOY_E2E=skip`, the
   `PHASE_SECONDS` lines.
2. Order at the top: `need …7 vars…` → tool check → phase validation:
   `case "$DEPLOY_PHASE" in ""|gate|release) ;; *) echo "DEPLOY_PHASE must be unset, gate or release" >&2; exit 2;; esac`
   (no value echo besides the allowed names). Then `DEPLOY_SHA`, dirty-tree warning.
3. Replace `phase_start`/`phase_seconds` and the two arrays with three helpers:
   - `phase <name>`: closes the open sub-step (appends ` <name>=$((SECONDS - T0))` to `PHASE_LINE`), opens
     `<name>` at `$SECONDS`.
   - `phase_skip <name>`: closes the open one, appends ` <name>=0`.
   - `phase_report`: closes the open one, `echo "PHASE_SECONDS${PHASE_LINE}"` (plain echo, column 0),
     resets `PHASE_LINE`.
4. Gate block (`if [ "$DEPLOY_PHASE" != release ]`): `say "Gate: …"`; `phase checks`; dry →
   `echo "DRY: gate: pnpm check"` else `pnpm check`; if `DEPLOY_E2E = skip` → `say "Skipping the Playwright
   run (DEPLOY_E2E=skip)"`, `phase_skip e2e`; else `phase e2e`; dry → `echo "DRY: gate: pnpm e2e"` else
   `pnpm e2e`. Then `phase_report`.
5. Release block (`if [ "$DEPLOY_PHASE" != gate ]`): `phase build` before the build; `phase resources` before
   "Resources: …" (covers D1/R2, bookmark, Access, DNS); `phase migrations` right before the migrations
   apply; `phase deploy` before the SVC_HASH/deploy; `phase smoke` before "Smoke test". After a passed smoke
   test: `phase_report`, then `echo "Live: https://$HOST"` and `echo "DEPLOY_SHA=$DEPLOY_SHA"` (unchanged).

Verify: T6 tests; manually
`DEPLOY_DRY_RUN=1 DEPLOY_PHASE=gate <sentinels> bash scripts/deploy.sh | grep '^PHASE_SECONDS'`.

## T3. `scripts/migrations-pending.sh`

Rewrite. Structure:

```bash
cd "$(dirname "$0")/.."
. scripts/lib/cf.sh                 # die, need, cf_api (token via -K on a pipe)
unset DEPLOY_DRY_RUN                # read-only script: never use cf_api's fake answers
need CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID          # exit 2, names the missing ones
command -v jq/curl or die
dir=$(jq -r '.paths.migrations.dir' clone.profile.json)  # apps/worker/migrations
local list: find "$dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort
none locally → exit 0
db_id=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database?name=budget-db&per_page=100" \
        | jq -r '[.result[]? | select(.name=="budget-db") | .uuid][0] // empty')  || { echo "…cannot list D1 databases" >&2; exit 1; }
empty db_id → print local list, exit 0
err=$(mktemp); trap 'rm -f "$err"' EXIT
if out=$(cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$db_id/query" \
          '{"sql":"SELECT name FROM d1_migrations ORDER BY id"}' 2>"$err"); then
  applied=$(jq -r '.result[0].results[]?.name' <<<"$out")
elif grep -q 'no such table' "$err"; then applied=""
else cat "$err" >&2; echo "ERROR: cannot read applied migrations of budget-db" >&2; exit 1; fi
print every local name not in $applied (grep -Fxv -f, or comm -23 on sorted lists); exit 0
```

`cf_api` messages already mask the account id. Never echo the token or the account id.

Verify: T7 tests. Optional, read-only, only if `CLOUDFLARE_API_TOKEN` is set in your shell:
`bash scripts/migrations-pending.sh; echo "exit $?"` (expect either all three file names, or a subset, or
a clean error; never a value of a variable).

## T4. `scripts/live-test-plans.sh`

Rewrite. Interface (stdout exactly as shown; errors to stderr):

| Command | Validation before any request | Requests | stdout | exit |
|---|---|---|---|---|
| `list` | – | GET `/api/v1/budgets` (200) | `<id>\t<name>` per prefixed plan, API order | 0 |
| `create '<name>'` | name present, starts with prefix (else `REFUSED: the name must start with ZZ-TEST`, exit 2; never echo the name) | POST `/api/v1/budgets` body `{"name":…}` built with `jq -nc --arg` (201) | `<id>` (`.data.budget.id`) | 0 |
| `delete <id>` | id matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (else exit 2) | GET `/api/v1/budgets/<id>`: 404 → `ERROR: no plan <id>` exit 1; name not prefixed → `REFUSED: plan <id> is not a test plan` exit 3; DELETE (200) | `deleted <id>` | 0 |
| `purge` | – | GET list; k>50 → `REFUSED: <k> test plans match (limit 50); nothing deleted` exit 3; per id: GET (404 → skip; not prefixed → skip), DELETE (200), n+=1 (`n=$((n+1))`); GET list again → m | `deleted <n> remaining <m>` | 0 if m=0 else 1 |
| other / none | usage on stderr | – | – | 2 |

Settings resolution, in this order, after argument validation:

1. `ROOT` = repo root; `PREFIX=$(jq -r .live.test_prefix clone.profile.json)`; empty → exit 1.
   (Prefix validation of `create` needs the prefix: read it first, then validate args, then the rest.)
2. If `LIVE_TEST_PLANS_BASE_URL` is set: must match `^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$` (else
   `ERROR: LIVE_TEST_PLANS_BASE_URL must be http://localhost[:port] or http://127.0.0.1[:port]`, exit 2).
   `MODE=local`. If `LIVE_TEST_PLANS_LOCAL_JWT=1`: `tmp=$(mktemp -d)`, `trap 'rm -rf "$tmp"' EXIT`,
   `node scripts/local-jwt.mjs --out "$tmp/jwt" >/dev/null` (fails → exit 1).
   Else: `LIVE_TEST_PLANS_LOCAL_JWT=1` set → exit 2 (only valid with the override). `BASE=$(jq -r .live.url
   clone.profile.json)`; `need`-style check of `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (print
   `Missing required environment variable: <NAME>` for each, exit 2). `MODE=live`.
3. `auth_config` function prints the curl config lines for the mode: live → the two
   `header = "CF-Access-Client-…: <value>"` lines; local+jwt → `header = "Cf-Access-Jwt-Assertion: <token>"`
   (read from the file); local without jwt → nothing.
4. `api METHOD PATH [BODY]` → sets `STATUS`, writes body to `$tmp/body`:
   `curl -sS --max-time 30 -o "$tmp/body" -w '%{http_code}' -X "$METHOD" -K <(auth_config) -H 'Accept: application/json' [-H 'Content-Type: application/json' --data-binary @- <<<"$BODY"] "$BASE$PATH"`.
   curl failure → `ERROR: cannot reach the clone` exit 1. Paths are only `/api/v1/budgets` and
   `/api/v1/budgets/<uuid>`. An `expect STATUS…` helper prints `ERROR: <METHOD> <path> answered <status>`
   and exits 1 on any other status. Never `cat` a body to the terminal.
5. Filter with `jq -r --arg p "$PREFIX" '.data.budgets[] | select(.name | startswith($p)) | …'`.

Create `$tmp` (mktemp -d, trap) in both modes for the body file. Remove the draft's `routes` and
`delete_import` subcommands (the profile holds that text).

Verify: T8 tests; `bash scripts/live-test-plans.sh list` with no credentials prints the two missing
variable names and exits 2.

## T5. `scripts/test/profile.test.ts`

Rewrite around a key list, so a failure names the path:

- `REQUIRED` = dotted paths: `repo.{install,check,e2e_full,e2e_specs,repeat_flag,deploy,deploy_phases,
  migrations_pending}`, `health.{path,version_field}`, `source.{url,single_tab,signed_out_markers,driver}`,
  `paths.{docs_dir,screenshots_dir,scratch_dir,shared_modules,always_overlap}`,
  `live.{url,test_space,test_prefix,health_path,auth_headers_from_env,auth.env,auth.headers,auth.scripts,
  auth.browser,recipes.get,recipes.create,recipes.delete,recipes.purge,recipes.delete_import,
  recipes.routes,never_run,never_touch,deploy,access}`.
  `it.each(REQUIRED)` → value is not `undefined`/`null`/`""`/empty array.
- Kept keys (present at 2d82719, hard-coded, no git call in the test; add to REQUIRED):
  `live.{deploy,deploy_env,access.headers,access.browser_helper,source_test_space}`, `repo.{workers_flag,dev}`,
  `health.dev_url`, `ports.{dev_web,dev_api,e2e_web,e2e_api}`, `box.{cpu_count,e2e_full_lock}`,
  `paths.{web_ui,tests,sensitive,migrations.dir,docs_index,e2e_state_dir}`.
- Values: `repo.deploy === "bash scripts/deploy.sh"`, `repo.deploy_phases === true`,
  `repo.migrations_pending === "bash scripts/migrations-pending.sh"`, `health.version_field === "deploy_sha"`,
  `source.driver === "cdp"`, `live.health_path === health.path`, `auth_headers_from_env` deep-equals the map,
  `auth.env`/`auth.headers` match it, `recipes.delete_import` exact text, each command recipe starts with
  `bash scripts/live-test-plans.sh `, `never_run` contains each of the 8 brief lines and `never_touch`
  contains the new line verbatim.
- Scripts: collect every match of `/scripts\/[A-Za-z0-9_./-]+\.(sh|mjs)/g` over the raw profile text;
  each exists (`existsSync`) and the three `.sh` the profile runs are executable (`statSync(p).mode & 0o111`;
  drop the `execSync stat` call).

## T6. `scripts/test/deploy-phases.test.ts` (+ keep `deploy.test.ts` green)

Same `run(env)` helper and sentinels as `deploy.test.ts`. Implement design cases 4–9 one `it` each;
case 7 as `it.each(["", "gate", "release"])` (pass `DEPLOY_PHASE` only when non-empty). Match the timing
lines with `/^PHASE_SECONDS checks=\d+ e2e=\d+$/m` and
`/^PHASE_SECONDS build=\d+ resources=\d+ migrations=\d+ deploy=\d+ smoke=\d+$/m`; compare `DEPLOY_SHA=` with
`git rev-parse HEAD`. In `deploy.test.ts`, only update strings if the new dry-run labels break it (they
should not: `DRY: gate` is a substring).

## T7. `scripts/test/migrations-pending.test.ts` (new) + `scripts/test/support/fake-curl.ts` (new)

`support/fake-curl.ts` exports `makeFakeCurl(): { bin: string; log: string; cleanup(): void }`: writes an
executable `curl` bash script into a temp dir that

- appends its argv (one line, joined) to `$FAKE_CURL_LOG`; for each `-K <file>` arg, appends
  `CONFIG:` + the header *names* found in that config (e.g. `CONFIG: CF-Access-Client-Id CF-Access-Client-Secret`);
- picks a canned response from env `FAKE_CURL_ROUTES` (JSON object: substring of `METHOD URL` → `{status, body}`),
  first match wins; no match → status 599 and exit 7 (curl "couldn't connect");
- honours `-o <file>` (writes body there) and `-w '%{http_code}'` (prints status), else prints body
  to stdout; consumes stdin when `--data-binary @-` is present.

Tests run `bash scripts/migrations-pending.sh` with `PATH=<bin>:$PATH`, sentinel `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID`, and `FAKE_CURL_ROUTES` per case (design case 11). Expected names come from
`readdirSync("apps/worker/migrations")` sorted. Shapes: list `{"success":true,"result":[{"name":"budget-db","uuid":"u1"}]}`;
query `{"success":true,"result":[{"results":[{"name":"…"}],"success":true}]}`; table missing
`{"success":false,"errors":[{"code":7500,"message":"no such table: d1_migrations: SQLITE_ERROR"}]}`;
auth error `{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`. Assert the log
never contains the token sentinel.

## T8. `scripts/test/live-test-plans.test.ts` (rewrite) + `scripts/test/support/dev-server.ts` (new)

`support/dev-server.ts` exports `startDevServer(): Promise<{ base: string; stop(): void }>`: move the body of
the `beforeAll`/`afterAll` in `dev-server.test.ts` (dev-vars, `db-migrate-local.sh` into a `mkdtemp` state
dir, vite on a free `127.0.0.1` port, detached, VITEST env stripped, wait for 200 on health; `stop` kills the
process group and removes the dir). Make `dev-server.test.ts` use it (behaviour unchanged).

`live-test-plans.test.ts`:

- `describe("against the local dev server")` with `beforeAll(startDevServer, 180_000)`; a `run(args, env)`
  helper spawning `bash scripts/live-test-plans.sh` with `PATH`, `HOME`, and
  `LIVE_TEST_PLANS_BASE_URL=<base>`; direct API calls with `fetch(base + …)` (the dev server signs them).
  Design case 12 a–g, in order, as separate `it`s sharing state.
- `describe("auth routing")`: a `node:http` server on a free port recording request headers and answering
  `{"data":{"budgets":[]}}`; design case 13 (requires `node scripts/dev-vars.mjs` run first for the JWT case).
- `describe("live mode")`: `makeFakeCurl()` with a route for `GET https://budget.doxen.dev/api/v1/budgets`;
  design case 14, plus the argument refusals (no command, unknown command, `create` without name,
  `create 'NoPrefix'`, `delete not-a-uuid`) each exiting 2 with an empty curl log.

## T9. `docs/conventions.md`

Commands section only: keep the four bullets and "Deploy phases" (correct it: gate = `pnpm check` +
`pnpm e2e`, `DEPLOY_E2E=skip`, unknown phase refused, `PHASE_SECONDS` sub-steps of each phase). Replace the
"Scripts" list with: `scripts/migrations-pending.sh` (read-only, needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`, output format, exit codes) and `scripts/live-test-plans.sh` (the four commands with
outputs and exit codes; `LIVE_TEST_PLANS_BASE_URL` for `pnpm dev` / e2e server, `LIVE_TEST_PLANS_LOCAL_JWT=1`
for the e2e server). Drop the `routes`/`delete_import` subcommands.

## Final checks

1. `pnpm check` passes (biome formats the new `.ts` files; run `pnpm exec biome check --write scripts/test`).
2. `pnpm e2e` passes.
3. `git diff 2d82719 --stat -- apps scripts/lib` is empty; `git diff 2d82719 --name-only` lists only Manifest
   files.
4. `grep -rn "sentinel-" scripts/*.sh` is empty (sentinels live only in tests).
