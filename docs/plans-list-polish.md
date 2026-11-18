# Plans list polish

Compared: read from the source's style rules (card, thumbnail, hover, delete button, red button). Behaviour and layout of the rest: not compared: built from the ticket.

- P1 card background `--backgroundSecondary` [applied]
- P2 hover/focus-within overlay (`::before`, new token `--scrimCardHover`), last-used line white, no background change [applied]
- P3 name and last-used centred; last-used one line with ellipsis [applied]
- P4 thumbnail tint and icon colour (new tokens `--calloutPrimarySubtleBackground`, `--calloutPrimaryProminentBackgroundEmphasis`), icon 60% wide, 24px from the top [applied]
- P5 gap 0, thumbnail margin-bottom 8px [applied]
- P6 heading margin and `--font-size-xl` [applied]
- P7 trash button: no border, no background, white 0.8em icon, 8px corner; focus ring kept [applied]
- P8 Create card: green icon (`--statusPositive`), hover `--labelPositiveActive` (new token), 16px gap, no hover background [applied]
- P9 red Delete in this dialog only (`.plans-list-delete-dialog`), `edit-account.css` untouched [scoped]
