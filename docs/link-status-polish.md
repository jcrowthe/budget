# Link status: polish list (EXF-866 with EXF-867)

- P1 `[applied]` Strip hover: the primary button (Relink, Reauthorize, Repair, Open Bank Connections) takes `--actionPrimary` while the strip is hovered, so it no longer blends into the strip; `.secondary` Unlink unchanged. Compared: read from the source's style rules (`.accounts-notification-item-di-action:hover button`).
- P2 `[applied]` The header's status label no longer has its own red; it inherits the header line's `--labelSecondary`. Compared: read from the source's style rules.
- P3 `[scoped]` The reauthorize banner in the connection detail has the info look (`--calloutPrimarySubtleBackground`, white text, key icon, primary button), through `data-kind="reauthorize"` only; Repair, Delayed and Unavailable banners are unchanged. Compared: read from the source.
- P4 `[scoped]` Unavailable uses the octagon and Reauthorize the key, in the Bank Connections list badge and the detail banner; Delayed keeps the clock and Repair the warning mark. The Unavailable banner keeps its warning colours.
