# Worker hardening (EXF-453): implementation spec

Design: [worker-hardening-design.md](worker-hardening-design.md). Do the tasks in order; run `pnpm check` after
each group. Never print a secret or an environment variable's value. Test emails use `example.test` or
`example.invalid`; never a real address. No migration.

## Task 0: remove the stale hygiene tests

- `scripts/test/repo-hygiene.test.ts`: delete the whole `describe("profile-completion scope", …)` block (and its
  `// Profile-completion design doc, Acceptance case 15.` comment) and the `import { execFileSync } from
  "node:child_process";` line. Keep `walk`, the branding test and the workflows test unchanged.
- Verify: `grep -n "profile-completion scope\|execFileSync" scripts/test/repo-hygiene.test.ts` prints nothing
  (design case 1).

## Task 1: secrets key derivation

### `apps/worker/src/secrets/crypto.ts`

Remove `fromBase64` and `importKey`. Add:

```ts
export const MIN_KEY_CHARS = 32;
export const HKDF_SALT = "budget-secrets-salt";          // fixed forever; versioning goes in info
export const keyInfo = (version: number) => `budget-secrets-v${version}`;
export class KeyTooShort extends Error {                  // message is fixed: never the value or its length
  constructor() { super("SECRETS_ENCRYPTION_KEY must be at least 32 characters"); this.name = "KeyTooShort"; }
}
/** AES-256-GCM key = HKDF-SHA-256(utf8(secret.trim()), salt = HKDF_SALT, info = keyInfo(version)). */
export async function deriveKey(secret: string, version: number): Promise<CryptoKey>;
```

- `const material = secret.trim(); if (material.length < MIN_KEY_CHARS) throw new KeyTooShort();`
- `crypto.subtle.importKey("raw", enc.encode(material), "HKDF", false, ["deriveKey"])`, then
  `crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(HKDF_SALT), info:
  enc.encode(keyInfo(version)) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])`.
- `seal` and `open` unchanged. Header comment: "The key is any string of at least 32 characters; HKDF derives
  the AES-256 key per key version."

### `apps/worker/src/secrets/index.ts`

- Import `deriveKey`, `KeyTooShort` instead of `importKey`.
- `keyFor(env, version)`: for version 1, unchanged "not set" check, then
  `try { return await deriveKey(env.SECRETS_ENCRYPTION_KEY, 1) } catch (e) { if (e instanceof KeyTooShort) throw
  new SecretsUnavailable(e.message); throw e; }`. Other versions: unchanged `No key for version N`.
- Rotation comment: "a later version N derives with keyInfo(N) from its own Worker secret; re-seal lazily."
- `setSecret`, `getSecret`, `deleteSecret`, `CURRENT_KEY_VERSION` unchanged.
- Check no other file imports `importKey`: `grep -rn importKey apps packages` must print only WebCrypto calls.

### `apps/worker/test/secrets.test.ts`

Keep every existing test (they cover design case 6; `otherKey` is 44 characters and still valid). Add a helper
`randomKey(n)` that returns `n` random characters from `[A-Za-z0-9+/]` (via `crypto.getRandomValues`) and add:

- `describe("key derivation")`:
  - `round-trips with a 32-character key that is not base64 of 32 bytes` (case 2): `k = randomKey(32)`; assert
    `atob(k).length !== 32` (it is 24); `setSecret({ ...env, SECRETS_ENCRYPTION_KEY: k }, "kd_32", "v32")` then
    `getSecret` with the same env → `"v32"`.
  - `round-trips with a 44-character base64 key` (case 3): `btoa` of 32 random bytes; same round-trip. Also
    `` ` ${k}\n` `` (padded) opens a record sealed with `k`.
  - `refuses a key shorter than 32 characters without revealing it` (case 4): `k = randomKey(31)`; for `k` and
    `` `  ${k}  ` ``, both `setSecret` and `getSecret` (seed a row first with the default env for `getSecret`)
    reject; capture the error message: contains `at least 32 characters`, does not contain `k`, any
    `k.slice(i, i + 6)`, or `"31"`.
- `describe("crypto")` importing from `../src/secrets/crypto`:
  - `derives a different key per version` (case 7): `k = randomKey(40)`; `seal(await deriveKey(k, 1), "n", "t")`;
    `open(await deriveKey(k, 1), …)` → `"t"`; `open(await deriveKey(k, 2), …)` rejects.

### `scripts/dev-vars.mjs`

Keep the generator (`randomBytes(32).toString("base64")`, 44 characters). Add a comment above
`SECRETS_ENCRYPTION_KEY`: "any string of at least 32 characters; the Worker derives the AES key with HKDF".

### `scripts/deploy.sh`

Right after the `need CLOUDFLARE_API_TOKEN … SECRETS_ENCRYPTION_KEY` line, before the tools loop and the
`DEPLOY_PHASE` case:

```bash
# The Worker derives its AES key from SECRETS_ENCRYPTION_KEY (trimmed) and refuses fewer than 32 characters.
key_trim="${SECRETS_ENCRYPTION_KEY#"${SECRETS_ENCRYPTION_KEY%%[![:space:]]*}"}"
key_trim="${key_trim%"${key_trim##*[![:space:]]}"}"
if [ "${#key_trim}" -lt 32 ]; then echo "SECRETS_ENCRYPTION_KEY must be at least 32 characters" >&2; exit 2; fi
unset key_trim
```

Never echo the value or `${#…}`. Update the header comment line "The required variables are checked in every
phase" to add "and SECRETS_ENCRYPTION_KEY must be at least 32 characters".

## Task 2: Worker-side identity pin

### `apps/worker/src/env.ts`

Add to `Env` after `ACCESS_AUD`:

```ts
/** The one user email allowed in (compared case-insensitively). Empty: no Access user token is accepted. Set by deploy. */
ACCESS_ALLOWED_EMAIL: string;
```

### `apps/worker/wrangler.jsonc`

`vars`: add `"ACCESS_ALLOWED_EMAIL": ""` after `"ACCESS_AUD": ""`. Nothing else.

### `apps/worker/src/middleware/access.ts`

- `type TokenOrigin = "local" | "access";`
- `toIdentity(payload, env, origin: TokenOrigin): Promise<Identity | null>`:
  - `email` (non-empty string claim) present:
    - `origin === "local"`: return the user identity iff `email.toLowerCase().endsWith("@localhost")`, else `null`.
    - `origin === "access"`: `const allowed = (env.ACCESS_ALLOWED_EMAIL ?? "").trim().toLowerCase();` return
      `{ kind: "user", actor: \`user:${email}\`, email }` iff `allowed !== "" && email.trim().toLowerCase() ===
      allowed`, else `null`. This applies in every environment.
  - no email: keep the `common_name` / empty `sub` check; look up `sha256Hex(clientId)` in the parsed
    `ACCESS_SERVICE_TOKENS`; return `{ kind: "service", actor: \`service:${name}\` }` only for a non-empty string
    name; an unknown hash or a malformed map (`JSON.parse` throws, or not an object) returns `null`. Remove
    `"unknown"`.
- `identify`: pass `"local"` from the HS256 branch and `"access"` from the RS256 branch. If the local branch
  verifies the signature but `toIdentity` returns `null`, return `null` (do not fall through to JWKS). Keep the
  outer `try … catch → null` and everything else.
- `accessMiddleware`: unchanged (same 403 bodies, no logging).

### `apps/worker/test/access.test.ts`

- Add `const OWNER = "owner@example.test";` and include `ACCESS_ALLOWED_EMAIL: OWNER` in `prod`. Change the
  existing RS256 user tokens from `me@example.test` to `OWNER` so the accept tests still pass and the refusal
  tests (wrong audience, missing `ACCESS_AUD`) still test what they name.
- New tests (names as given):
  - `accepts the allowed email case-insensitively` (case 8): env `ACCESS_ALLOWED_EMAIL: "Owner@Example.test"`,
    token email `owner@example.TEST`: `GET /api/v1/health` 200; `POST /api/v1/budgets` `{ name: "ZZ-TEST pin" }`
    201 and `change_log.actor` for the new id is `user:owner@example.TEST`.
  - `refuses another email with an otherwise valid token` (case 9): token `someone@example.test` → 403, JSON
    `error.name` `forbidden`.
  - `refuses every user token when ACCESS_ALLOWED_EMAIL is empty in production` (case 10): `""` and `"  "`,
    token `OWNER` → 403.
  - Keep `derives service:<name> from common_name` (case 11); rename it
    `records a known service token under its name`.
  - `refuses an unknown service token` (case 12): valid service token; maps `{ [otherHex]: "x" }`, `"{}"`,
    `"not json"` → 403 each.
  - `refuses a local token whose email is not @localhost` (case 13): `localToken({ email: "someone@example.test" })`
    with the default (local) env → 403.
  - Keep `PRODUCTION CONFIG REFUSES THE LOCAL TEST TOKEN` and `accepts a local token when ENVIRONMENT is local`
    unchanged.
- Leave `apps/worker/test/helpers.ts` (`tester@localhost`) and the e2e helpers (`e2e@localhost`) unchanged.

### `scripts/deploy.sh` (deploy step)

Replace the inline `--var` arguments with an array built before the `is_dry` branch, after `SVC_MAP`:

```bash
DEPLOY_VARS=(ENVIRONMENT "production" DEPLOY_SHA "$DEPLOY_SHA" ACCESS_AUD "$ACCESS_AUD_VALUE"
  ACCESS_TEAM_DOMAIN "$ACCESS_TEAM" ACCESS_SERVICE_TOKENS "$SVC_MAP" ACCESS_ALLOWED_EMAIL "$ACCESS_ALLOWED_EMAIL")
```

- Real run: turn pairs into `--var "NAME:VALUE"` arguments for the same `run_wrangler deploy` call (secrets file
  unchanged).
- Dry run: print `DRY: wrangler deploy vars: <names from the even indexes, space separated>` and
  `DRY: ACCESS_SERVICE_TOKENS entries: $(jq 'length' <<<"$SVC_MAP")`. No value is printed.
- `ACCESS_AUD_VALUE` and `ACCESS_TEAM` are set by `ensure_access` in dry run too (`req_id` gives `dry-run-id`);
  confirm under `set -u` by running the dry-run tests.

### `scripts/test/deploy.test.ts` and `scripts/test/deploy-phases.test.ts`

- Change the sentinel `SECRETS_ENCRYPTION_KEY` in both files to a 36-character value such as
  `"sentinel-key-ggg777-0123456789abcdef"` (still checked by `noLeak`).
- `deploy.test.ts` dry-run test (case 16): also assert the output matches
  `/^DRY: wrangler deploy vars: .*\bACCESS_SERVICE_TOKENS\b.*\bACCESS_ALLOWED_EMAIL\b/m` and contains
  `DRY: ACCESS_SERVICE_TOKENS entries: 1`.
- `deploy-phases.test.ts`: add `it.each(["", "gate", "release"])("refuses a short SECRETS_ENCRYPTION_KEY in
  phase %j", …)` (case 5): sentinels with `SECRETS_ENCRYPTION_KEY` = a 31-character sentinel (e.g.
  `"sentinel-short-hhh888-012345678"`, check its length in the test), `DEPLOY_DRY_RUN=1`: `status` 2, stderr
  contains `SECRETS_ENCRYPTION_KEY must be at least 32 characters`, output has no `DRY:`, `Gate`, `Build`, no
  `31`, and no 6-character substring of the key; `noLeak` too. Also one run with the 31-character key padded with
  spaces (`"  " + k + "  "`) is refused the same way.
- The existing missing-variable tests stay as they are (a missing key is named by `need`, exit 2).

## Task 3: idempotency retry tests

`apps/worker/test/idempotency.test.ts`: add `describe("idempotency reservation retry")`. No change to
`apps/worker/src/middleware/idempotency.ts` unless a test fails for a real bug; if so, fix the smallest thing and
say so in the commit message.

- Mini app: `new Hono<AppEnv>()`; `use("*", (c, next) => { c.set("identity", { kind: "user", actor: ACTOR });
  return next(); })` with `ACTOR = "user:retry@example.test"`; `use("/api/v1/*", idempotency())`;
  `post("/api/v1/thing", (c) => { calls++; return c.json({ data: { ok: true } }, 201); })`.
  Request with `app.request(path, { method: "POST", headers: { "Idempotency-Key": key, "Content-Type":
  "application/json" }, body: "{}" }, { ...env, DB: hooked })`. Use a distinct key per test.
- `hookD1(real: D1Database, hooks: { beforeSelect?: () => Promise<void>; beforeInsert?: () => Promise<void> })`:
  returns a `Proxy` over `real` whose `prepare(sql)` returns the real statement unless `sql` (lower-cased)
  starts with `select` or `insert into` and contains `"idempotency_keys"`; then it returns a wrapper whose
  `bind(...)` returns a wrapper whose `run`, `all`, `raw`, `first` await the hook and then call the real bound
  statement. Every other property is the real one, bound to `real`. Check the SQL drizzle emits (log it once
  while writing the test, then remove the log) and adjust the match.
- `seed(key)`: `env.DB.prepare("INSERT INTO idempotency_keys (actor, key, method, path, request_hash, status,
  response_body, created_at) VALUES (?, ?, 'POST', '/api/v1/thing', 'other', 0, '', ?)").bind(ACTOR, key, new
  Date().toISOString()).run()`; `unseed(key)` deletes it. Hooks use the real `env.DB`, never `hooked`.
- `retries when the reserved row vanishes before it is read` (case 14): `seed("retry1")`; `beforeSelect` deletes
  the row on its first call only and counts calls. Expect 201, `calls === 1`, select count 1, no
  `Idempotent-Replayed` header, and `SELECT status FROM idempotency_keys WHERE actor = ? AND key = 'retry1'` is
  201.
- `answers 409 when the row vanishes on every attempt` (case 15): `beforeInsert` seeds (INSERT OR IGNORE), and
  `beforeSelect` deletes, both counting. Expect 409, body `error.name` `idempotency_key_in_progress`,
  `calls === 0`, insert count 3, select count 3.

## Task 4: docs

- `docs/conventions.md`, "Product rules", **Access only** bullet: append "The Worker also pins identity: an
  Access user token must carry `ACCESS_ALLOWED_EMAIL` (case-insensitive; empty refuses all), a service token
  must be listed in `ACCESS_SERVICE_TOKENS`, and locally signed `@localhost` tokens work only when
  `ENVIRONMENT` is `local`. `SECRETS_ENCRYPTION_KEY` is any string of at least 32 characters (HKDF per key
  version); the deploy refuses a shorter one." In "Deploy phases", after "The required variables are checked
  first, in every phase", add "(and `SECRETS_ENCRYPTION_KEY` must be at least 32 characters, else exit 2)".
- `docs/scaffold-spec.md` line 110: replace "`importKey(b64)` (exactly 32 bytes, AES-GCM)" with
  "`deriveKey(secret, version)` (HKDF-SHA-256 from a key of 32+ characters to AES-256-GCM; see
  worker-hardening-design.md)".
- `docs/README.md`: already has this Build's line; do not edit it.

## Final verification

- `pnpm check` exits 0 (all new and existing Worker and script tests).
- `pnpm e2e` exits 0.
- `grep -rn "32 bytes" apps scripts docs/conventions.md` prints nothing about the encryption key.
- `git diff --name-only 43b7ce9` lists only files in the design doc's Manifest `touches`.
