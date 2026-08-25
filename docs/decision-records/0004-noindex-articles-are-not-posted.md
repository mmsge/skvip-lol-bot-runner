# 0004 — Articles marked `robots.noindex` are not posted

**Status:** Accepted
**Contributors:** Markus (asked & decided: skip them — reversing an earlier call the same day, on seeing the count) + Claude (surfaced the count, proposed keeping the policy configurable)
**Topics:** editorial, privacy, copyright, config

## Context

Five of the fourteen published articles carry `robots.noindex: true`, and they
are not filler:

| Article | Category | What it is |
|---|---|---|
| Vi kan lære noko av Nils Vik. Ver litt meir ineffektiv. | Kultur | real commentary |
| – Det er kanskje godt for Alver å få en ny ordfører | Intervju | real interview |
| Rogfast vil revolusjonere Vestlandet… | Kommentar | real commentary, the only tagged article on the site |
| Torsdag 20. august | Aktuelt | daily brief, skipped anyway |
| Velkommen til Vestlendingen | Kommentar | launch editorial |

Two explanations fit, and they point opposite ways:

- **launch-window housekeeping** nobody cleared — the 19 August clustering
  supports this, though four unflagged articles from the same batch argue
  against it;
- **duplicate-content suppression**, because those pieces are republished from a
  partner outlet. That is a standard reason a paper noindexes its own work, and
  it would make them precisely the articles it least wants mirrored.

Nobody outside the paper can tell which. Markus first chose to post them, then
revised the same day on seeing that it was four posts out of twelve — a third of
the account's opening content — resting on a flag nobody outside the paper can
interpret.

## Decision

**Skip them.** `NOINDEX_POLICY` defaults to `skip`.

The reasoning that settles it is the asymmetry. Skipping costs reach on four
posts and is undone by flipping one variable. Posting cannot be undone from other
people's timelines, and if the duplicate-content reading is right, those are
exactly the articles the paper least wants mirrored.

Two things follow, and both are load-bearing:

1. **Ask the editors what the flag means**, in the same note that announces the
   robot. Their answer is now worth something concrete: if it was launch-window
   housekeeping, four good articles come back.
2. **`NOINDEX_POLICY` stays a config value** (`skip` | `unlisted` | `post`)
   rather than being compiled away, so the answer can be acted on the same hour
   it arrives. `unlisted` is the middle setting if they say it is about search
   engines specifically.

## Consequences

- The account opens with 8 posts rather than 12. That difference is what this
  decision costs, and it is measured rather than guessed —
  `test/corpus.test.js` pins both numbers.
- A held article is **deferred, not written off.** The seen-store keeps two maps:
  `seen` for articles it is finished with, and `deferred` for ones held *only* by
  this policy. That is what makes "four good articles come back" a config change
  rather than an archaeology exercise. Without it, flipping the policy would
  affect future articles only, because the first run marks the current corpus
  seen by design.
- **Deferral survives the article ageing out.** A noindex hold defers even once
  the article is also older than `MAX_ARTICLE_AGE_HOURS`, which is the case that
  actually matters: the editors' answer may well arrive after the 72-hour window
  has closed on these five. Writing them off at 72 hours would have made the
  answer worthless. To act on it: set `VESTLENDINGEN_NOINDEX_POLICY=post` and
  raise `MAX_ARTICLE_AGE_HOURS` for one cycle.
- A hold that is **not only** noindex is written off normally — "Torsdag 20.
  august" is both noindex and a daily brief, and the daily-brief judgement is
  never revisited.
- The **fallback honours the same policy**, because the article page carries the
  same flag as a `<meta name="robots">` tag (ADR 0002). A Sanity outage does not
  quietly reverse this decision.
- The **RSS feed omits them too.** A feed is an index, and indexing what we
  decided not to index would be the same decision made twice, differently.
- A label (category or tag) carrying its own `robots.noindex` is dropped from the
  hashtags, for the same reason.
