# Source URL design (EXF-458)

Point `source.url` in `clone.profile.json` at the Test Budget plan, so that no step that opens `source.url`
can land on whichever plan the person used last in YNAB.

## Why

The source app is the person's real YNAB account. Steps may open only the plan "Test Budget"
(`542b334b-696e-4418-937a-5e2c21a8b45c`). `source.url` is `https://app.ynab.com`, the bare site. YNAB opens
the plan used last when given the bare site, and the templates open `source.url` themselves when the browser has
no source tab (Discover Thread `p_1dca579d8d604381bbdd2de216b284ee`). With the plan's own URL as `source.url`,
the first page a step opens is the Test Budget, whichever plan was used last.

## Source

There is no screen to compare. The study covered the box's source check, not the YNAB UI. Notes:
`/workspace/scratch/source/exf458/notes.md`. In summary:

- `/workspace/.exfab/bin/source_check.sh` takes the URL from `request.json .source_url`, or from `pget source.url`.
  `pget` reads the **snapshot** `/workspace/.exfab/profile.json` that `load_profile` writes when the step starts. It
  does not read the repo's `clone.profile.json`, so an edit made in this Build is visible to the stock check
  only after a later step reloads the profile from the branch.
- **Matching rule: by host.** `host` is the URL with its scheme and path removed (`app.ynab.com`). A tab matches
  when `.type == "page"` and `.url | contains(host)`. The check ignores the path, so a tab on `/…/budget`,
  `/…/accounts` or `/…/reflect/…` passes no matter which form `source.url` takes.
- The check also curls `source.url` without a cookie. Both `…/<id>/budget` and `…/<id>/` answer HTTP 302 (not
  `000`), so the reachability test passes.
- Test run (read only): a scratch copy of the check, with its snapshot set to the new value, printed
  `Source check OK: https://app.ynab.com/542b334b-…/budget reachable (HTTP 302) … source tab: …/budget
  Plan | Test Budget | YNAB`.

## Approach

- Use `source.url` = `https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget`. The ticket asks for
  this form, it is the plan's landing page, and it is the URL already in `live.source_test_space`. Because the
  check matches by host, the ticket's fallback form (`…/<id>/`) is not needed.
- Add a profile test that pins `source.url` to the test plan, so a later Build cannot revert it without a failing
  check.
- Leave every other key as it is, including `source.single_tab`, `source.signed_out_markers` and `source.driver`.
- `docs/conventions.md` does not mention the source URL (`grep -n "ynab\|source.url" docs/conventions.md`
  finds only the branding rule), so it does not change.

## What changes

- `clone.profile.json`: only the value of `source.url` changes. The key order and every other byte stay the same.
- `scripts/test/profile.test.ts`: one new `it` in the `clone.profile.json` describe block, with this rule:
  - `source.url` starts with `https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/`, so it contains the plan
    id. The bare site, `https://app.ynab.com/`, and any other plan's URL all fail.
  - `live.source_test_space` contains `source.url`, so the two values cannot drift apart.
- `docs/source-url-design.md`, `docs/source-url-spec.md` and one line in `docs/README.md`.

There is no user-visible change in the app, nothing under `apps/` changes, and there are no migrations.

## Downstream effects

- Starting with the first step that reloads the profile from a branch containing this change, the source check
  prints the new URL. Its tab matching does not change, because the host is the same.
- Any template that opens `source.url` in a new page opens the Test Budget plan page.
- Other Builds: `clone.profile.json` is in `paths.always_overlap`, and this Build runs alone.

## Out of scope

Any UI change, anything under `apps/`, any other profile key, and the platform's own scripts in
`/workspace/.exfab`, which this Build only reads or copies to scratch.

## Rules for every step

In the source app, the only allowed action is to navigate the one open `app.ynab.com` tab between
`https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget` and
`https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/accounts`. Never open the bare site, another plan or the
plan list. Never click, type, close the tab or kill the browser. Finish with the tab back on `/budget`. Never
print an environment variable's value.

## Acceptance

Run every case from `/workspace/repo` on the Thread branch.

1. **Profile value.** `jq -r .source.url clone.profile.json` prints exactly
   `https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget`.
2. **Nothing else changed in the profile.** `git diff origin/main -- clone.profile.json` shows exactly one
   removed line and one added line, both the `"url"` line under `source`. `jq -S 'del(.source.url)'` gives the same
   output for both versions:
   `diff <(git show origin/main:clone.profile.json | jq -S 'del(.source.url)') <(jq -S 'del(.source.url)' clone.profile.json)`
   prints nothing and exits 0.
3. **Profile test passes.** `pnpm vitest run scripts/test/profile.test.ts` exits 0. The new test appears in the
   output as passing.
4. **Profile test catches the bare site.** Set the value back temporarily:
   `cp clone.profile.json /tmp/p.json && jq '.source.url="https://app.ynab.com"' /tmp/p.json > clone.profile.json`,
   then run `pnpm vitest run scripts/test/profile.test.ts`. It exits non-zero, and the failing test is the new
   source-url test. Repeat with `https://app.ynab.com/` and with
   `https://app.ynab.com/00000000-0000-0000-0000-000000000000/budget`: both fail the same way. Restore the file
   with `cp /tmp/p.json clone.profile.json`, and confirm `git status --short clone.profile.json` shows no change
   from the committed version.
5. **Source check, tab on the plan page.** Make sure an `app.ynab.com` tab is open on
   `…/542b334b-…/budget` (if there is none, open it with the command in the ticket). Then:
   a. Run `bash /workspace/.exfab/bin/source_check.sh` and `jq -r .source.url /workspace/.exfab/profile.json`.
      Record which URL the snapshot holds. If it holds the new URL, the stock check is the verification: expect
      `Source check OK: https://app.ynab.com/542b334b-…/budget reachable (HTTP 302)` and exit 0.
   b. If the snapshot still holds the bare site, run the scratch copy that reads the repo value (spec, task 3):
      `bash /workspace/scratch/exf458-sim/bin/source_check.sh`. Expect exit 0 and the line
      `Source check OK: https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget reachable (HTTP 302), CDP on port <n>, source tab: https://app.ynab.com/542b334b-…/budget …`.
6. **Source check, tab on the accounts page.** Navigate the same tab, without opening a new one, to
   `https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/accounts` (spec, task 3), then wait for it to load.
   Run the same check or checks as in case 5. Expect exit 0, with `source tab:` showing a URL that contains
   `/542b334b-696e-4418-937a-5e2c21a8b45c/accounts`. Navigate the tab back to `…/budget`. Afterwards, `/json/list`
   shows exactly one `app.ynab.com` page, on `…/budget`.
7. **The report states the rule.** The step's report says that the check matches by host
   (`.url | contains("app.ynab.com")`), that the `/budget` form works, that the `…/<id>/` fallback was not needed,
   and whether the stock check read the new value or the scratch copy was used.
8. **Full checks.** `pnpm check` exits 0.

## Manifest

touches: [clone.profile.json, scripts/test/profile.test.ts, docs/source-url-design.md, docs/source-url-spec.md, docs/README.md]
shared: []
migrations: 0
