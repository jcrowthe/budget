# Source URL spec (EXF-458)

The design is in [source-url-design.md](source-url-design.md). In this box, run `pnpm install --frozen-lockfile`
once before any test command, because `node_modules` is not installed yet.

Constants used below:

- `PLAN_ID` = `542b334b-696e-4418-937a-5e2c21a8b45c`
- `PLAN_URL` = `https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget`
- `ACCOUNTS_URL` = `https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/accounts`

## Task 1: profile value

File: `clone.profile.json`, key `source.url`.

- Change only the string: `"url": "https://app.ynab.com"` becomes `"url": "<PLAN_URL>"`. Do not reformat the file,
  and do not touch `single_tab`, `signed_out_markers`, `driver` or any other key.
- Verify: design acceptance cases 1 and 2 (`jq -r .source.url clone.profile.json`, and the `jq -S 'del(.source.url)'`
  diff against `origin/main`).

## Task 2: profile test

File: `scripts/test/profile.test.ts`, inside `describe("clone.profile.json", …)`.

- Add a module constant `const TEST_PLAN_ID = "542b334b-696e-4418-937a-5e2c21a8b45c";` next to `REQUIRED`.
- Add `it("points source.url at the Test Budget plan only", …)` with these assertions:
  - `expect(profile.source.url).toMatch(new RegExp(`^https://app\\.ynab\\.com/${TEST_PLAN_ID}/`))`. Write the
    regex out literally if that reads better, with every `.` escaped.
  - `expect(profile.source.url).toContain(TEST_PLAN_ID)`. This is redundant with the regex, but it gives a clear
    failure message that names the id.
  - `expect(profile.live.source_test_space).toContain(profile.source.url)`.
- Keep the other tests as they are. Lint rules come from Biome (`biome check .` in `pnpm check`), with double
  quotes and trailing commas, the same as the rest of the file.
- Verify: design acceptance cases 3 and 4. Run the test against the bare site, against `https://app.ynab.com/` and
  against an all-zero plan id: each run fails, and the failing test is this one. Restore the file afterwards.

## Task 3: verify the source check (no repository change)

This task only reads the platform's scripts in `/workspace/.exfab`. It never edits them.

1. Stock check: `bash /workspace/.exfab/bin/source_check.sh; echo exit=$?` and
   `jq -r .source.url /workspace/.exfab/profile.json`. If the snapshot already holds `PLAN_URL`, the stock check
   is enough. Otherwise build the scratch copy in step 2.
2. Scratch copy that reads the repo's value. This exact recipe was run once on the plan page in the Architect's
   step, and it printed `Source check OK`:
   ```
   S=/workspace/scratch/exf458-sim; rm -rf $S; mkdir -p $S/bin
   cp /workspace/.exfab/bin/{lib.sh,profile.cjs,source_check.sh} $S/bin/
   cp /workspace/.exfab/*keeper*.json $S/ 2>/dev/null || true
   sed -i "s#^X=/workspace/.exfab#X=$S#" $S/bin/lib.sh
   sed -i "s#'/workspace/.exfab/profile.json'#'$S/profile.json'#" $S/bin/profile.cjs
   sed -i "s#/workspace/.exfab/bin/lib.sh#$S/bin/lib.sh#" $S/bin/source_check.sh
   cp /workspace/repo/clone.profile.json $S/profile.json
   bash $S/bin/source_check.sh; echo exit=$?
   ```
   `$S` has no `request.json`, so the copy reads `source.url` from `$S/profile.json`, which holds the committed
   repo value.
3. Plan page: with the one `app.ynab.com` tab on `PLAN_URL`, run step 1 and, if needed, step 2. Expect exit 0.
4. Accounts page: navigate **the same tab** to `ACCOUNTS_URL`. Use `playwright-core`, installed under
   `/workspace/scratch/pw` and never in the repository:
   - `chromium.connectOverCDP("http://127.0.0.1:<port>")`, where `<port>` comes from
     `ps aux | grep -o 'remote-debugging-port=[0-9]*' | head -1 | cut -d= -f2`.
   - `page = browser.contexts()[0].pages().find(p => p.url().includes(PLAN_ID))`. If no page matches, stop and
     report. Never open the bare site.
   - `await page.goto(ACCOUNTS_URL, { waitUntil: "domcontentloaded" })`, then wait about 5 s, then
     `browser.close()`. That call only disconnects.
   Run the check or checks again. Expect exit 0, with `source tab:` showing `…/<PLAN_ID>/accounts`.
5. Navigate the same tab back to `PLAN_URL` the same way. Confirm with
   `curl -s http://127.0.0.1:<port>/json/list | jq -r '.[] | select(.type=="page") | .url' | grep -c app.ynab.com`,
   which prints `1`, and check that the URL ends with `/budget`.
6. If the accounts-page check fails, the check matches by URL prefix after all. Set `source.url` to
   `https://app.ynab.com/<PLAN_ID>/` and change the Task 2 regex only if it no longer fits. Repeat steps 2 to 5,
   and update the design doc's Approach to name the form that works.
7. Report: the matching rule (host, `.url | contains("app.ynab.com")`), the form that works, and whether the
   stock check or the scratch copy did the verification.

Delete `/workspace/scratch/exf458-sim` and `/workspace/scratch/pw` when you are done, or leave them. They are
outside the repository either way.

## Task 4: docs

- `docs/conventions.md`: no change. It does not mention the source URL.
- The design doc, the spec and the `docs/README.md` line are already committed by the Architect.

## Final

- `pnpm check` exits 0.
- `git diff origin/main --stat` lists only `clone.profile.json`, `scripts/test/profile.test.ts` and the three docs
  files. Nothing is under `apps/`.
- Commit on the Thread branch. The message starts with `EXF-458: `.
