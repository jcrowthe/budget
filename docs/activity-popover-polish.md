# Activity popover polish (EXF-509)

- [applied] P1 `.activity-button` hover: colour `--actionPrimary` and underline (source `.budget-number:hover`, read from the live CSSOM; a non-zero hover cannot be rendered in the source, every row there is $0.00); on a selected row the colour stays `--labelPrimary` and only the underline shows. Zero amounts are plain spans, so they are unaffected. Compared live: the zero button does not change on hover, as the rule says. Feature-owned class, not shared.
