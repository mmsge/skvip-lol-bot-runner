// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Article shape both sources return.
 *
 * `source-sanity.js` and `source-sitemap.js` disagree about almost everything
 * except this: whatever they read upstream, they hand the rest of the service
 * one of these. Every consumer downstream — filters, toot, feed, poller — is
 * written against this shape and never against a source's own vocabulary, which
 * is what lets the fallback be a genuine fallback rather than a second codebase.
 *
 *   id          stable identity. Sanity's `_id`. NEVER the slug or the URL —
 *               a slug rewrite would otherwise repost an article (ADR 0003).
 *   altKeys     additional identities this article has been known by, so the
 *               seen-store recognises it whichever source produced it. The
 *               fallback recovers the same `_id` from the article page, but if
 *               that ever stops working the slug key still prevents a repost
 *               (ADR 0002).
 *   publishedAt ISO 8601. Matches the sitemap `lastmod` on every article
 *               probed; `updatedAt` is a separate field tracking edits.
 *   heading     the paper's headline, verbatim apart from whitespace.
 *   intro       the paper's lead, verbatim apart from whitespace.
 *   categories  the paper's section for the article, as { name, noindex }.
 *   tags        the paper's article tags, as { name, noindex }. Kept SEPARATE
 *               from categories because they are capped separately: the
 *               category always makes the post, the tags are trimmed to fit
 *               (plan Appendix A).
 *   walled      true when the article is behind a paywall or registration wall.
 *   image       { altText, caption, ref } or null. Read, and deliberately
 *               unused — the photo reaches the timeline through Mastodon's own
 *               link preview card, never as uploaded media (ADR 0001 / plan §5).
 */

/**
 * Collapse CMS whitespace.
 *
 * `heading` and `intro` arrive from Sanity with trailing spaces, and headings
 * occasionally carry a non-breaking space mid-string. Both go into a character
 * budget, so they are normalised once here rather than at each use.
 */
function normaliseText(value) {
  if (value == null) return "";
  return String(value).replace(/[\s ]+/g, " ").trim();
}

/** Build the canonical article URL from the publisher's origin and slug. */
function articleUrl(origin, slug) {
  return `${String(origin).replace(/\/+$/, "")}/artikler/${slug}`;
}

/**
 * Normalise one label (a category or tag document) to { name, noindex }.
 *
 * The label text is the publisher's own `name` field. We never transliterate it
 * — that is what keeps `#SjømatOgHavbruk` and `#Ålesund` spelled the way the
 * paper spells them, with no table of ours to go stale (ADR 0006).
 */
function makeLabel(raw) {
  if (!raw) return null;
  const name = normaliseText(raw.name);
  if (!name) return null;
  return { name, noindex: raw.noindex === true };
}

/**
 * Assemble an Article. Missing pieces become empty/false rather than undefined,
 * so a consumer never has to guard for a shape difference between the sources.
 */
function makeArticle(fields) {
  const heading = normaliseText(fields.heading);
  const intro = normaliseText(fields.intro);
  const categories = (fields.categories || []).map(makeLabel).filter(Boolean);
  const tags = (fields.tags || []).map(makeLabel).filter(Boolean);

  const id = String(fields.id);
  const slug = fields.slug || "";

  return {
    id,
    altKeys: slug ? [`slug:${slug}`] : [],
    publishedAt: fields.publishedAt || null,
    updatedAt: fields.updatedAt || null,
    heading,
    intro,
    slug,
    url: fields.url,
    noindex: fields.noindex === true,
    walled: fields.walled === true,
    categories,
    tags,
    image: fields.image && fields.image.ref ? fields.image : null,
    source: fields.source,
  };
}

/**
 * Sort newest first, breaking ties on `id`.
 *
 * `publishedAt` alone is not a total order on this corpus: four articles share
 * `2026-08-19T20:00:00Z` and two more share `2026-08-24T21:39:00Z`. Without the
 * tie-break, two articles published in the same minute could come back in a
 * different order on a retry and post out of order (ADR 0003).
 */
function byNewest(a, b) {
  const ta = Date.parse(a.publishedAt || 0) || 0;
  const tb = Date.parse(b.publishedAt || 0) || 0;
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

module.exports = { makeArticle, makeLabel, normaliseText, articleUrl, byNewest };
