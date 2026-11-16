# Categories polish (EXF-494, EXF-495)

- P1 [applied] `.popover-buttons` gets `margin-top: 12.24px`: popovers are 108.7px tall with the buttons 20.24px below the input.
- P2 [applied] The ⊕ is hidden while its popover is open (live measurement wins over the design doc); the `active` class stays as a hook.
- P3 [applied] `:focus-visible` rings with `--actionPrimary` on `.popover-button` (primary 2px), `.group-name` and the toolbar buttons, all plan-local classes.
- P4 [applied] Popover traps Tab and Shift+Tab between its first and last tabbable (also covers Hidden Categories).
