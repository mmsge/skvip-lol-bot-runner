# 0003 — Key articles on `_id`, and break ordering ties on it too

**Status:** Accepted
**Contributors:** Claude (agent decision — no human input on the technical choice)
**Topics:** identity, idempotency, ordering, data-sources

## Context

Three timestamps are available per article, and they are not the same thing:

- **`publishedAt`** — when the paper published it. Matches the sitemap
  `lastmod` exactly on every article checked.
- **`_updatedAt`** — Sanity's own field, which moves whenever the document is
  edited.
- **sitemap `lastmod`** — equal to `publishedAt`, not to `_updatedAt`.

And the corpus has a property that is easy to miss: **`publishedAt` is not a
total order.** Four articles share `2026-08-19T20:00:00Z` and two more share
`2026-08-24T21:39:00Z`.

## Decision

1. **Articles are keyed on `_id`.** Never the slug, never the URL.
2. **`publishedAt` drives the age filter**, not `_updatedAt`.
3. **Ordering breaks ties on `_id`**, in the GROQ query (`order(publishedAt desc,
   _id desc)`) and in every sort this service does.
4. **The Mastodon `Idempotency-Key` is derived from `_id`** — hashed, so the key
   carries no readable upstream identifier.

## Consequences

- A slug rewrite upstream cannot make an old article look new. Keying on the URL
  would have reposted it.
- An article edited months after publication does not resurface, because the age
  filter reads `publishedAt`. Keying the filter off `_updatedAt` would have
  turned every typo fix into a repost.
- Two articles published in the same minute cannot swap order between a cycle and
  its retry.
- A crash between Mastodon accepting a status and the seen-store landing on disk
  cannot duplicate: the retry presents the same idempotency key and Mastodon
  returns the status it already created.
- The RSS `guid` is the `_id` with `isPermaLink="false"`, so a slug rewrite does
  not orphan an item a reader has already seen.
- The fallback has to recover the same `_id` from the article page for any of
  this to hold across a source switch. It does; see ADR 0002.
