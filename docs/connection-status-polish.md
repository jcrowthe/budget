# Connection status: polish list (EXF-465, EXF-824)

Each item was measured by the Designer from the source's loaded style rules and scripts ("compared: read from the source's style rules"). Layout and behaviour beyond these were "not compared: built from the ticket".

- P1 [applied] Mark icon colour: white for every status (`color: var(--labelPrimary)` in the feature's own `.nav-account-row .nav-link-status`; global.css untouched).
- P2 [applied] Mark badge only for `login_required` and `broken`; hover `--statusMarkHover: rgba(255,255,255,0.3)` (local property, no token has 0.3). Delayed has no badge.
- P3 [applied] Popup layout: title, then `Last checked …` (connected) or `Last attempted …` (other statuses; `Not checked yet` when never synced), then the explanation in a bordered box (`--separatorStandard`, 16px, radius 0.4rem); lines 20px, margin 0. `popupFor` returns `details`; its test is updated.
- P4 [applied] Popup-only explanation copy (`POPUP_REPAIR_DETAILS`, `POPUP_DELAYED_DETAILS`); `REPAIR_TEXT` and `DELAYED_TEXT` stay for the Manage Bank Connections detail. No Learn More link.
- P5 [applied] Strips with an action (repair, broken) are clickable as a whole with the pointer cursor and `--calloutPrimaryProminentBackgroundEmphasis` on hover; a click on the strip runs the button's action. No hover or click when Repair is disabled, nor on the delayed line.
- P6 [applied] Repair error: `#4c0814` fill (declared on `.acct-connection-error`, as in plan-panel.css) with `--labelPrimary` text.
- P7 [applied] `text-align: center` on `.acct-connection-notice`, `.acct-connection-error`, `.mc-notice` and the popup's messages.
- P8 [applied] Popup arrow 30×15 (clip-path, `--backgroundTertiary`) pointing at the mark's centre; the popup sits 15px from the mark (`ARROW_DEPTH`), arrow on the right edge when it flips left. `placeStatusPopup` returns `side` and `arrowTop`; its test is updated.
- P9 [applied] `WarningTriangleIcon` (`shell/connection-status-icon.tsx`) in the strip (16px) and in the mark for `login_required`/`broken` (12px). `LinkStatusIcon`, the header and the Manage Bank Connections badges unchanged.
