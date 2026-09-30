# 0011 — Post each toot in the item's own language

**Status:** Accepted
**Contributors:** Markus (asked & decided: non-English items are posted in their original language, marked as such) + Claude (proposed/implemented: read `items.lang`, fall back to the bot's language, survive a database without the column)
**Topics:** mastodon, language, sqlite, contract, deploy-order

## Context

`@linjeskift@skvip.lol` posted every toot with the bot's fixed `LANGUAGE`, `en`.
linjeskift now ingests Dutch, Norwegian and Swedish feeds and posts their
titles and snippets untranslated, so a fixed `en` would mislabel them. Mastodon
uses the `language` of a status for language filters and for the translate
button.

## Decision

1. `lib/source-linjeskift.js` selects `items.lang` (an ISO 639-1 code written by
   linjeskift 1.1.0 and later) and `makeArticle` carries it as `language`. A
   value that is not two or three lowercase letters becomes `null`.
2. `lib/poller.js` posts with `article.language || config.language`. The
   robot's `LANGUAGE` stays `en` and is now only the fallback, so old rows
   (`lang IS NULL`) and the Sanity robot behave as before.
3. **The runner works against a database without the column.** Deploy order can
   slip, so the source checks `PRAGMA table_info(items)` each cycle and selects
   `NULL AS lang` when `lang` is absent. Both paths are tested against real
   SQLite files.

## Consequences

- **linjeskift deploys first** (it adds the column in place, and starts filling
  it). The runner can deploy before or after without failing: until it is
  deployed it still posts `en`, and until the column exists it reads `NULL`.
- The schema coupling in ADR 0010 gains one column, optional on the runner side.
- The bot's bio on skvip.lol is set by hand and says the headlines are in the
  original language, now more than one. `summary` in `bots/linjeskift.js` has
  been updated, and the live bio needs the same edit.
