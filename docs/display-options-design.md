# Display Options (EXF-472)

A per-user appearance dialog, opened from the Plan menu ("Display Options"): **Theme** (Default = light, Dark,
Match System), **Progress Bars** (On, Off) and **Balance Style** (Default, Differentiate Without Color). A choice
previews at once; **Apply** (or Enter) keeps it, **Cancel**, ✕ and Escape restore the saved values.

## Source and ACs

Ticket EXF-472. Its six criteria and the specs that prove them (`e2e/display-options.spec.ts`, one test per AC):

| AC | Test |
| -- | -- |
| 1 three sections, current values (Dark / On / Default) | "AC1 …" |
| 2 Default turns the app light at once, Cancel brings Dark back | "AC2 …" (also ✕ and Escape) |
| 3 Apply or Enter persists across a reload and on another browser | "AC3 …" (two tests: persistence, first paint) |
| 4 ←/→ cycle the theme cards | "AC4 …" |
| 5 Progress Bars Off removes the bars after Apply | "AC5 …" (also Cancel, and the toolbar toggle) |
| 6 Match System follows the OS colour scheme | "AC6 …" (`page.emulateMedia({ colorScheme })`) |

Also: "Balance style" (the four pill states), "Dark tokens unchanged", and "light contrast" (Plan in both
styles, a register, two dialogs).

## API and storage

- `GET /api/v1/settings` → `{ data: { theme, progress_bars, balance_style } }`; `PATCH /api/v1/settings` takes a
  partial, strict body (an unknown key, a wrong enum or a wrong type is a 422) and returns the full, updated
  object. User level, not per plan.
- Table `user_settings` (migration `20261126120000_user_settings.sql`, additive): `actor` (primary key, the
  identity actor `user:<email>` / `service:<name>`), `theme`, `progress_bars`, `balance_style`, `updated_at`.
  No row means the defaults: dark / on / default.
- Each non-empty PATCH is one `db.batch([upsert, change_log])`; the log row has `budget_id` NULL,
  `entity_type = 'user_settings'`, `entity_id = <actor>`, `create` for the first write and `update` after.
  An empty body writes nothing. D1 calls: GET 1, PATCH 1 read + 1 batch (`apps/worker/test/settings.test.ts`).
- Settings writes are not on the plan undo stack.

## MCP parity decision

**An exclusion, with no tools.** Both operations are `excluded` in `apps/worker/test/mcp-coverage/settings.ts`
("interface state"). Reasons: the ticket says MCP is not needed; the settings only change how this browser draws
the app (the same class as `ui-state` and the report settings, both excluded the same way); an agent has no use
for a theme. The pinned tool counts stay at 121 and the two count tests are untouched. `settings.test.ts` asserts
that no `get_settings` / `update_settings` tool exists and that both lines are exclusions, so adding tools later
means changing that test on purpose.

## Theme mechanics

- `<html>` carries exactly one of `theme-dark` / `theme-light`; with no class the page is dark (the `:root`
  tokens), so a missing class can never break Dark. `<body>` mirrors `theme-dark` when dark. `<html>` carries
  `balance-no-color` for Differentiate Without Color.
- `default` → light, `dark` → dark, `match_system` → `matchMedia('(prefers-color-scheme: dark)')`, with a live
  `change` listener while Match System is in effect (saved or previewed). `resolveTheme` in
  `apps/web/src/settings/theme.ts`.
- First paint: an inline script in `apps/web/index.html` reads localStorage `theme` (`default|dark|match_system`;
  missing or anything else is dark) and sets the class before any CSS paints. The app writes `theme` when the
  settings load and after a successful Apply. `theme.test.ts` runs the real script against `resolveTheme`.
- `DisplaySync` (mounted once in `main.tsx`) applies the effective settings. Until the saved settings arrive, and
  if they never do, the first-paint class stays (a placeholder or a failed load is not a choice).
- Preview: `settings/displayStore.ts` holds an unsaved `preview` over the saved settings; Apply saves then clears
  it, Cancel clears it. The Plan toolbar's Progress Bars toggle is the same setting and saves at once. The old
  `budget.progressBars` localStorage key is dropped, not migrated.
- Keyboard: ←/→ move the Theme card (wrapping) and preview it; Enter applies unless focus is on a button; Escape
  cancels. A failed Apply keeps the dialog and the preview and shows "Couldn't save display options.".
- `--colorScheme` (dark / light) replaces the literal `color-scheme: dark` in global.css, plan-grid.css and
  manage-payees.css.

## Tokens

Every colour literal of the editable stylesheets moved into `shell/tokens.css` with the dark value unchanged
(`no-raw-colours.test.ts` keeps it that way for every stylesheet except `register/**`, `plan/panel/**` and the two
token files). Variables that were declared inside a page or report scope on main (for example `.reflect`,
`.plan-page`) are now on `:root` with the same value. Proof that Dark is identical: the computed custom
properties of `:root` and the computed background, colour and border of the body, sidebar, group and category
rows, the four pill tones, the menu, a dialog and its backdrop were read on main and on this branch
(`/workspace/thread/evidence/dark-main.json`, `dark-branch.json`, `dark-diff.txt`: no differences), and
"Dark tokens unchanged" pins about twenty of them in the e2e.

## The light palette

`shell/theme-light.css`, selector `:root.theme-light` (specificity 0,2,0, so it wins over every `:root` block
whatever the order of the bundle). `theme-light.test.ts` fails when a colour token has no light value. The system:

| Role | Dark | Light |
| -- | -- | -- |
| ground (`--backgroundPrimary`) | #0c0d22 | #ffffff |
| secondary / elevated | #15172d / #292b3d | #f3f4fa / #eceef7 |
| text (`--labelPrimary`) | #fff | #14152b |
| secondary / tertiary text | #c4c5cf / #9b9caa | #43455c / #5b5d74 |
| accent (`--actionPrimary`) | #7583ff | #5560f0 (links `--labelAction` #3640c7) |
| primary button fill | #545bfe | #aab2ff, dark label |
| positive (`--statusPositive`) | #77ba21 | #3d6b0c, white label (it is also a text colour) |
| negative fill / text | #bf2e3b / #ee5867 | #e8707b, dark label / #b3202f |
| cautious pill | #f6c91d | #f6c91d, dark label |

Fills that carry a label are light or mid tones with a dark label, so a stylesheet that writes
`color: var(--labelPrimary)` on a fill reads in both themes. Tooltips stay dark in both. New tokens:
`--labelOnColor`, `--labelPositive`, `--labelError`, `--helpIcon`, `--separatorFaint`, `--countPill*`,
`--shadowTooltipLarge`, `--statusMarkHover`, `--pillCautiousOutline`, `--pillCautiousText`, `--colorScheme` and the
theme-independent `--preview*` (the Display Options drawings).

### Variables of units closed to this Build, overridden from theme-light.css

- `register/register.css` (:root, lines 1–35): `--register-actionbar-bg`, `-actionbar-hover`, `-actionbar-shadow`,
  `-banner-bg`, `-entry-row`, `-flag-{blue,green,orange,purple,red,yellow}` and their `-pill`, `-icon-disabled`,
  `-icon-muted`, `-input-placeholder`, `-keycap-bg`, `-label-action`, `-menu-bg`, `-menu-disabled`, `-menu-hover`,
  `-needs-category`, `-needs-category-label`, `-primary-active`, `-row-selected`, `-scheduled-header-bg`,
  `-scheduled-label`.
- `plan/panel/plan-panel.css` (:root, 2–13 and 328–332): `--rowSelected`, `--panelTooltipLabel`,
  `--panelTooltipShadow`, `--calloutNegativeSubtleBackground*`, `--calloutWarning*`, `--calloutNegativeAccent`,
  `--budgetBar*`.
- `plan/panel/target.css` (:root, 3–11): `--statusCautious`, `--categoryBalanceCautiousLabel`,
  `--calloutCautiousBackground`, `--calloutPositiveBackground`, `--switchOffTrack`, `--segmentedTrack`,
  `--calloutBadgeBackground`, `--popupBackground`.

## Leftover literals (follow-ups for MREP / FUTA2)

Colour literals still written inside `register/**` and `plan/panel/**` (not variables). Each is overridden for
light by a selector rule at the end of `theme-light.css`, so none leaves a checked element below 4.5:1; the
sweeps (`weakText` in the contrast spec, plus a one-off sweep of the inspector and the Reflect pages) found no
text under 4.5:1. The fix belongs to the owner: use a token, then delete the override.

| File:line | Literal | Effect in light |
| -- | -- | -- |
| `plan/panel/plan-panel.css:36` | `color-scheme: dark` | the inspector's scrollbars would be dark; overridden to `light` |
| `plan/panel/plan-panel.css:124` | `rgba(255, 255, 255, 0.08)` | an invisible card rule; overridden with `--borderSubtle` |
| `plan/panel/plan-panel.css:232` | `#727484` | grey pencil icon, 4.0:1; overridden with `--iconFillSecondary` |
| `register/register.css:573` | `rgba(0, 0, 0, 0.1)` | a shadow, harmless; overridden for the light tone |
| `register/register.css:661` | `rgba(114, 116, 132, 0.18)` | a key cap behind disabled bulk items; overridden with `--keyCapBackground` |

Comments in `register.css:931` and `:973–974` quote hex values; they are not colours. Left alone on purpose in the
editable files: the app logo's brand fill (`shell/icons.tsx` `Logo`, the same in both themes) and the fallback
inside `var(--backgroundTertiary, #fff)` in `account/icons.tsx`.

## Shared e2e helpers that assume dark colours

None were edited. Specs that pin dark colours (`plan-menu`, `shell-compare`, `plan-grid`, …) run as the shared
`e2e@localhost` user, who has no saved settings, so they get Dark.

## Existing specs edited

- `e2e/plan-grid.spec.ts`, `e2e/card-payments.spec.ts`: one line each, `test.use({ storageState: … })` with a user
  of their own. They toggle Progress Bars, which is now a per-user setting shared by every spec of the
  `e2e@localhost` user. No assertion changed.
- `e2e/plan-menu.spec.ts` ("6 EXF-470"): "Display Options" joins the enabled list, as the entries of earlier
  builds did. It was asserted disabled until this entry was registered. (Outside the contract's May touch list.)

## Balance Style: Differentiate Without Color

The four Available pill states differ by more than colour (`plan-grid.css`, `.balance-no-color .available-pill`):

| State | Fill | Outline |
| -- | -- | -- |
| positive | solid | 1px, same colour as the fill |
| cautious | none | 2px dashed |
| negative | none | 3px solid |
| zero | none | 1px solid |

Colours and the minus sign stay. The pill keeps its outer size (22px high; the padding gives up the border), so
the grid does not move. The rule is scoped by an ancestor class, so it also covers the inspector's pills; `.plain`
(set by the dialog on the Default card) keeps the default look inside it. The e2e compares (filled, border style,
border width) tuples: all four differ, so the states are told apart in greyscale.
