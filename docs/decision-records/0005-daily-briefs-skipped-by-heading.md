# 0005 — Skip the daily briefs by heading pattern, not by category

**Status:** Accepted
**Contributors:** Markus (asked & decided: skip the daily briefs) + Claude (proposed the heading rule over the category rule)
**Topics:** editorial, filtering, nynorsk

## Context

"Torsdag 20. august" and "Fredag 21. august" are link roundups whose entire
intro is "Dagens viktigste saker." As a toot they say nothing — a weekday, a
date, and a sentence that could head any day's list. They also carry no main
image, so even the preview card would be bare.

## Decision

Skip them, matching the **heading** against a full-string pattern:

```
^(m[åa]ndag|tysdag|tirsdag|onsdag|torsdag|fredag|laurdag|l[øo]rdag|sundag|s[øo]ndag)
  \s+\d{1,2}\.\s+(januar|februar|…|desember)$
```

Configurable as `SKIP_HEADING_PATTERN`, and every skip is counted in the cycle
summary.

## Consequences

- **Skipping by category would have been wrong**, and this is the whole point of
  the record. The briefs sit in `aktuelt` — and so does "Datasentre står i kø for
  å bli bygget", "Sjå bilete frå lanseringa av Vestlendingen", and everything
  else the paper files as news. A category rule would have silenced the news
  section to remove two roundups.
- **Both written traditions are covered** (`tysdag`/`tirsdag`,
  `laurdag`/`lørdag`, `sundag`/`søndag`/`sondag`), because the paper publishes in
  both Bokmål and Nynorsk, sometimes within the same hour.
- The pattern is **anchored at both ends**, so "Torsdag 20. august vart det klart
  at bybanen kjem" is a real article and posts. `test/filters.test.js` pins that.
- Skips are counted per reason in `cycle.finished` and on the status page, so a
  pattern that starts eating real articles is visible before anyone notices the
  account has gone quiet.
- If the paper renames the briefs, the pattern stops matching and two thin posts
  appear. That is the failure direction to prefer: visible, and fixed by editing
  one env var.
