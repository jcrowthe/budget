# Credit engine: polish list

- P1 [applied] The card icon is a card with an exclamation mark on a 14 viewBox, drawn in our own style, rendered at 13×13 with margin `auto .35rem auto auto` (source: 13×13, centred).
- P2 [applied] `.available-pill.cautious` uses new tokens `--categoryBalanceWarningBackground` #f6c91d and, on hover, `--categoryBalanceWarningBackgroundActive` #daac00. It also changes the target (underfunded) pills, as the item says. `--statusCautious` is untouched.
- P3 [applied] `OverspentMessage` comes after the rows; margin-top `--space-2`, centred, radius .5rem, line-height 1.2, amount chip (600, padding 0 4px, radius 4px, `--calloutWarningSubtleBackgroundEmphasis` #a38100 for cautious).
- P4 [applied] Each tone has its own colour in the feature's CSS (`--calloutNegativeLabel`, `--calloutWarningSubtleBackgroundLabel`, replacing `--calloutSubtleLabel`), which beats reflect.css's global `.negative` (left alone); negative chip `--calloutNegativeSubtleBackgroundEmphasis` #912333.
- P5 [applied] A credit-overspent pill's title is "You've overspent this category by $X with credit. …", X the credit part (`creditOverspentTitle` in plan/format.ts).
- P6 [applied] A payment category's pill uses `paymentPillTitle` (positive "You have $X set aside for payment. …", negative "Red in your payment? …", zero empty), in plan/format.ts.
- P7 [applied] The `min-width` on `.cell-available` is removed; the pill has `max-width: 100%; min-width: 0; overflow: hidden`, the amount span `min-width: 0; overflow: hidden`, the icon `flex: none`. T14.4 no longer checks the pill's scrollWidth (departure from spec T14.4: the source clips, 84.3px at 1024); it checks the pill is inside its cell, does not overlap Activity, and the icon is inside the pill. Message and spending-line checks stay.
- P8 [applied] The credit pill's icon margin is `0 .35rem 2px 0`, so with the pill's 4px/2px padding the 13px icon sits 4.5px under the pill's top (source: exactly centred in the 22px pill). Other pill icons are untouched.
- P9 [applied] `.panel-card-body:has(> .inspector-message)` has 16px bottom padding (source: 16px under the box); the shared `.panel-card-body` padding is unchanged.
