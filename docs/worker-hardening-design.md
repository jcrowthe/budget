# Worker hardening (EXF-453): design

Three gaps in shared Worker modules, plus one stale test, fixed in one Build that runs alone:

0. Remove the `profile-completion scope` tests from `scripts/test/repo-hygiene.test.ts`.
1. Secrets: derive the AES-256-GCM key with HKDF from any `SECRETS_ENCRYPTION_KEY` of 32+ characters.
2. Access: the Worker itself pins who may get in (one user email, known service tokens, local tokens only locally).
3. Idempotency: named tests for the reservation retry and its 409 fallback.

Must merge before any Build stores a secret (the Plaid work). Builds on main `43b7ce9`.

## Source

This ticket has no UI and no behaviour a user of the source app can observe: it changes key derivation,
token checks and tests inside the clone's Worker. There is nothing in the source app to reproduce, so no source
study was run and no notes or screenshots exist for it. No acceptance case compares with the source app.

## Current state (read in the code)

- `apps/worker/src/secrets/crypto.ts` `importKey(b64)` base64-decodes the key and throws unless it is exactly
  32 bytes. The live key is a 32-character base64-alphabet string (~24 bytes), so `setSecret`/`getSecret` would
  throw in production. The `secrets` table is empty in production, so the derivation can change with no
  re-encryption.
- `apps/worker/src/middleware/access.ts` `toIdentity` accepts any `email` claim, and maps a service token whose
  `sha256(common_name)` is not in `ACCESS_SERVICE_TOKENS` to `service:unknown`. Locally signed HS256 tokens are
  accepted only when `ENVIRONMENT === "local"` and `LOCAL_JWT_SECRET` is set; they carry `dev@localhost`
  (`scripts/local-jwt.mjs`, `apps/web/dev/local-access.ts`), `tester@localhost` (`apps/worker/test/helpers.ts`)
  or `e2e@localhost` (`e2e/global-setup.ts`, `e2e/support/auth.ts`).
- `scripts/deploy.sh` already requires `ACCESS_ALLOWED_EMAIL` (used by `scripts/lib/access.sh` for the Access
  policy) but does not pass it to the Worker. It passes `ACCESS_SERVICE_TOKENS` as `{sha256hex(CF_ACCESS_CLIENT_ID):
  SERVICE_TOKEN_NAME}`, which is how the smoke test's service token gets a name.
- `apps/worker/src/middleware/idempotency.ts` lines 49–97: up to 3 attempts of INSERT … ON CONFLICT DO UPDATE
  WHERE expired; if no row changed, SELECT the row; if it vanished, retry; after 3 attempts, 409
  `idempotency_key_in_progress`. `apps/worker/test/idempotency.test.ts` never reaches the vanished-row path.
- `scripts/test/deploy.test.ts` and `scripts/test/deploy-phases.test.ts` use the sentinel
  `SECRETS_ENCRYPTION_KEY: "sentinel-key-ggg777"` (19 characters), which the new preflight would refuse.

## Approach

### 0. Stale hygiene tests

Delete the whole `describe("profile-completion scope", …)` block and the `execFileSync` import (nothing else
uses it). The branding and workflows tests stay as they are.

### 1. Secrets key derivation

`crypto.ts` replaces `importKey(b64)` with `deriveKey(secret, version)`:

- `material = secret.trim()`; if `material.length < 32` (UTF-16 code units, the same as characters for any
  key that will really be used) throw `KeyTooShort` with the fixed message
  `SECRETS_ENCRYPTION_KEY must be at least 32 characters`. The message never contains the value, a fragment
  of it, or its length.
- HKDF-SHA-256 through WebCrypto: base key = `importKey("raw", utf8(material), "HKDF", false, ["deriveKey"])`;
  `deriveKey({ name: "HKDF", hash: "SHA-256", salt: utf8("budget-secrets-salt"), info: utf8("budget-secrets-v" +
  version) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])`. The salt is a fixed
  application constant; the version in `info` makes each key version derive a different key from the same input.
- `seal` and `open` are unchanged: random 96-bit IV per record, record name as AAD.
- `secrets/index.ts` `keyFor(env, version)`: version 1 → `deriveKey(env.SECRETS_ENCRYPTION_KEY, 1)`; a missing
  key stays `SecretsUnavailable("SECRETS_ENCRYPTION_KEY is not set")`; `KeyTooShort` is rethrown as
  `SecretsUnavailable` with the same fixed message. `key_version` column, `CURRENT_KEY_VERSION = 1` and "only
  this module touches the table" are unchanged. The rotation comment says a later version derives with its own
  `info` (and, if rotated, its own Worker secret).
- Any string of 32+ characters is accepted, so the old 44-character base64 keys (Worker tests, `.dev.vars`) keep
  working. `scripts/dev-vars.mjs` keeps generating 32 random bytes as base64 (44 characters); its comment states
  the rule.
- `scripts/deploy.sh`: right after `need …` (which runs before both phases), a preflight trims
  `SECRETS_ENCRYPTION_KEY` the same way and, when shorter than 32 characters, prints to stderr
  `SECRETS_ENCRYPTION_KEY must be at least 32 characters` and exits 2. It runs before the `DEPLOY_PHASE`
  check, the gate and any `DRY:` line. When the key is missing, `need` has already exited 2 naming it.

### 2. Worker-side identity pin

New plain variable `ACCESS_ALLOWED_EMAIL: string` in `Env` and `wrangler.jsonc` `vars` (default `""`). The deploy
passes it with `--var "ACCESS_ALLOWED_EMAIL:$ACCESS_ALLOWED_EMAIL"` next to the other `--var`s.

`identify` knows which verifier accepted the token and passes it to `toIdentity(payload, env, origin)`, with
`origin` `"local"` (HS256 with `LOCAL_JWT_SECRET`, only reachable when `ENVIRONMENT === "local"`, as today) or
`"access"` (RS256 against the team's JWKS). Rules, each failing closed (`null` → 403):

| Token | Accepted when | Identity |
|---|---|---|
| user, origin `access` | `lower(trim(email)) === lower(trim(ACCESS_ALLOWED_EMAIL))` and the variable is not empty after trim, in **every** environment | `user:<email as in token>` |
| user, origin `local` | email ends with `@localhost` (case-insensitive) | `user:<email>` |
| service (`common_name`, empty `sub`) | `ACCESS_SERVICE_TOKENS[sha256hex(common_name)]` is a non-empty string; a malformed map refuses | `service:<name>` |
| anything else | never | — |

So `dev@localhost`, `tester@localhost` and `e2e@localhost` keep working locally, and a production Worker
(`ENVIRONMENT: "production"` in `wrangler.jsonc` and `--var` in deploy) never takes the local path. An empty
`ACCESS_ALLOWED_EMAIL` refuses every Access user token. `service:unknown` disappears. The 403 body stays
`{error:{id:"403",name:"forbidden",detail:"Forbidden"}}` for `/api/*` and `/mcp`, `text/plain` otherwise: no
reason is given and nothing is logged.

Deploy dry run: the deploy step builds the `--var` list once (an array) and, in dry run, prints the variable
**names** from that same array and the number of entries in the service-token map, never a value:
`DRY: wrangler deploy vars: ENVIRONMENT DEPLOY_SHA ACCESS_AUD ACCESS_TEAM_DOMAIN ACCESS_SERVICE_TOKENS ACCESS_ALLOWED_EMAIL`
then `DRY: ACCESS_SERVICE_TOKENS entries: 1`. The line still starts with `DRY: wrangler deploy`, so the
existing order checks hold.

### 3. Idempotency retry tests

No production code change unless a test shows a bug (analysis says the loop is correct). The tests run the real
`idempotency()` middleware in a small Hono app in the test file: a stub middleware sets a fixed identity, then
`idempotency()`, then a POST handler that counts its calls and returns 201. The app gets `{ ...env, DB: hooked }`
where `hooked` wraps the real D1 binding: statements whose SQL is a SELECT from or an INSERT into
`idempotency_keys` run a test hook first (using the real `env.DB`), everything else (and `batch`, `exec`, …) is
delegated untouched.

- Retry: a fresh pending row for the same actor and key is seeded; the select hook deletes it the first time.
  Attempt 1 conflicts (changes 0), the read finds nothing, attempt 2 reserves, the handler runs once → 201 and
  the stored row has status 201.
- Fallback: the insert hook (re)seeds the fresh row before every insert and the select hook deletes it before
  every read. All 3 attempts fail → 409 `idempotency_key_in_progress`, handler calls 0, 3 inserts and 3 reads.

## Downstream effects

- Production: after the next release, only the owner's email (as set in the deploy environment, the same value
  as the Access policy) and the deploy's service token get in. The live smoke test, `scripts/live-test-plans.sh`
  and `scripts/access-browser.mjs` use `CF_ACCESS_CLIENT_ID`, whose hash the deploy puts into
  `ACCESS_SERVICE_TOKENS`, so they keep working (Access sets `common_name` to the client id of a service token).
  MCP clients that sign in through Access OAuth carry the owner's email and pass the pin.
- Any future service token must be added to `ACCESS_SERVICE_TOKENS` by the deploy, or it gets 403.
- Secrets can now be stored in production; later Builds (Plaid) use `setSecret`/`getSecret` unchanged.
- `docs/conventions.md` "Access only" rule gains the pin and the key rule; `docs/scaffold-spec.md` line 110
  stops saying "exactly 32 bytes".

## Out of scope

No Plaid code, no route or page, no migration, no change to `scripts/lib/access.sh` or `clone.profile.json`, no
logging of refusals, no key rotation tooling, no change to `apps/worker/vitest.config.ts` (its 44-character key
stays valid; tests that need other keys override `SECRETS_ENCRYPTION_KEY` per call).

## Acceptance

All cases run in the repository; none compares with the source app. "Worker test" means a named test in
`apps/worker/test/*.test.ts` run by `pnpm check`. Test emails use `example.test` / `example.invalid`.

1. **Hygiene block gone.** `grep -n "profile-completion scope\|execFileSync" scripts/test/repo-hygiene.test.ts`
   prints nothing; the branding and workflows tests still run and pass in `pnpm check`.
2. **32-character key round-trips.** Worker test (secrets): with `SECRETS_ENCRYPTION_KEY` set to a random
   32-character string over `[A-Za-z0-9+/]` that does not base64-decode to 32 bytes, `setSecret` then
   `getSecret` returns the value.
3. **44-character base64 key round-trips.** Worker test: base64 of 32 random bytes as the key; set then get
   returns the value. Leading/trailing whitespace around a valid key also round-trips with the same key.
4. **31-character key refused by the module.** Worker test: `setSecret` and `getSecret` with a 31-character key
   (and with 31 characters padded by spaces) reject with a message containing `at least 32 characters`; the
   message contains neither the key nor any 6-character substring of it, nor the text `31`.
5. **31-character key refused by the deploy.** Script test: `bash scripts/deploy.sh` with all sentinel variables,
   `DEPLOY_DRY_RUN=1`, and a 31-character `SECRETS_ENCRYPTION_KEY`, in each of `DEPLOY_PHASE` unset, `gate`,
   `release`: exit 2, stderr contains `SECRETS_ENCRYPTION_KEY must be at least 32 characters`, output contains
   no `DRY:`, `Gate` or `Build`, and neither the key nor any 6-character substring of it, nor `31`.
6. **Ciphertext, wrong key, tamper, AAD.** The existing Worker tests still pass: stored ciphertext is not the
   plaintext; a different key fails to decrypt; a tampered record fails; a record copied from name A to name B
   fails to open.
7. **Versions derive different keys.** Worker test on `crypto.ts`: from the same input, a record sealed with
   `deriveKey(k, 1)` opens with a fresh `deriveKey(k, 1)` and is rejected by `deriveKey(k, 2)`.
8. **Allowed email passes.** Worker test (access): production env, `ACCESS_ALLOWED_EMAIL: "Owner@Example.test"`,
   RS256 token with `email: "owner@example.TEST"` → `GET /api/v1/health` 200; a `POST /api/v1/budgets` with it
   records `change_log.actor` `user:owner@example.TEST`.
9. **Other email refused.** Same env, an otherwise valid token with `email: "someone@example.test"` → 403 with
   `error.name` `forbidden`.
10. **Empty pin fails closed.** Production env with `ACCESS_ALLOWED_EMAIL` `""` and with `"  "`: a valid RS256
    user token → 403.
11. **Known service token.** Production env, `ACCESS_SERVICE_TOKENS` mapping the client id's hash to `ci-token`:
    POST creates a plan and `change_log.actor` is `service:ci-token` (existing test, kept).
12. **Unknown service token refused.** Production env, a valid service token whose hash is not in the map → 403;
    also with map `{}` and with a malformed map (`not json`).
13. **Local stays local.** The existing `PRODUCTION CONFIG REFUSES THE LOCAL TEST TOKEN` test passes unchanged;
    a local token (local env) with `tester@localhost` → 200; a correctly signed local token with
    `email: "someone@example.test"` → 403.
14. **Idempotency retry.** Worker test `retries when the reserved row vanishes before it is read`: 201, handler
    called once, select hook fired once, response has no `Idempotent-Replayed`, stored row status 201.
15. **Idempotency 409 fallback.** Worker test `answers 409 when the row vanishes on every attempt`: 409,
    `error.name` `idempotency_key_in_progress`, handler called 0 times, insert and select hooks each fired 3
    times.
16. **Deploy dry run still sets the map and now the pin.** `scripts/test/deploy.test.ts` dry run (sentinels with a
    ≥32-character key): exit 0, release order unchanged, output contains
    `DRY: wrangler deploy vars:` listing `ACCESS_SERVICE_TOKENS` and `ACCESS_ALLOWED_EMAIL`, and
    `DRY: ACCESS_SERVICE_TOKENS entries: 1`; no sentinel value appears. The missing-variable tests still name
    every missing key and exit 2.
17. **Full checks.** `pnpm check` exits 0 and `pnpm e2e` exits 0 (the e2e `access.spec.ts` and every flow keep
    signing in with `e2e@localhost`).

## Manifest

touches: [apps/worker/src/secrets/crypto.ts, apps/worker/src/secrets/index.ts, apps/worker/src/middleware/access.ts, apps/worker/src/middleware/idempotency.ts, apps/worker/src/env.ts, apps/worker/wrangler.jsonc, apps/worker/test/secrets.test.ts, apps/worker/test/access.test.ts, apps/worker/test/idempotency.test.ts, scripts/deploy.sh, scripts/dev-vars.mjs, scripts/test/deploy.test.ts, scripts/test/deploy-phases.test.ts, scripts/test/repo-hygiene.test.ts, docs/worker-hardening-design.md, docs/worker-hardening-spec.md, docs/README.md, docs/conventions.md, docs/scaffold-spec.md]
shared: [apps/worker/src/secrets/** (HKDF key derivation, 32-character minimum), apps/worker/src/middleware/** (access.ts identity pin; idempotency.ts only if the new tests show a bug)]
migrations: 0
