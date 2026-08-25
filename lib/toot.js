// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Composition and the character budget.
 *
 * The post is the paper's own wording — heading, intro, link, hashtags — with no
 * translation and no commentary of ours:
 *
 *     – Heimekontor-forbod: Ein gåvepakke til Oslo-staten
 *
 *     Du får ikkje dei beste folka ved å tvinge dei inn til Oslo-kontoret, …
 *
 *     https://www.vestlendingen.no/artikler/heimekontor-forbod-…
 *
 *     #Vestlandet #nyhende #Kommentar
 *
 * The leading dash on quote headlines is the paper's convention, not a stray
 * character — it is kept.
 */
const { buildHashtags, renderHashtags } = require("./hashtags");

const LIMIT = 500;
// Mastodon replaces every URL with a fixed-width placeholder before counting,
// so a 120-character article URL costs the same as a short one. Composing
// against the real length would refuse posts that fit comfortably.
const URL_WEIGHT = 23;
// Prefixed to the heading of a walled article. A walled article is posted
// rather than skipped, so the timeline stays an honest index of what the paper
// published — the lock says up front that the link asks for something.
const LOCK = "🔒";

/**
 * Count characters the way Mastodon counts them.
 *
 * Two differences from `String.length`, and both bite on this corpus: Ruby
 * counts codepoints where JS counts UTF-16 units (so the lock emoji would count
 * twice), and every URL counts as 23 whatever its real length.
 */
function weigh(text, urls = []) {
  let n = [...String(text)].length;
  for (const url of urls) {
    if (!url) continue;
    n -= [...url].length;
    n += URL_WEIGHT;
  }
  return n;
}

/**
 * Trim text to `budget` characters at a word boundary, ending with an ellipsis.
 *
 * Returns "" when the budget cannot hold even a token amount, so the caller
 * drops the paragraph rather than emitting a lone "…".
 */
function trimToWord(text, budget) {
  const chars = [...String(text)];
  if (budget <= 1) return "";
  if (chars.length <= budget) return chars.join("");

  // One character of the budget belongs to the ellipsis.
  let kept = chars.slice(0, budget - 1).join("");
  const lastSpace = kept.lastIndexOf(" ");
  // Only honour the word boundary if it leaves something worth reading;
  // otherwise a long unbroken string would trim away to nothing.
  if (lastSpace > budget * 0.5) kept = kept.slice(0, lastSpace);
  kept = kept.replace(/[\s,;:.–—-]+$/u, "");
  return kept ? `${kept}…` : "";
}

/**
 * Compose one article into a status.
 *
 * Returns { text, chars, truncated, hashtags }. Overflow trims the INTRO only,
 * and only at a word boundary: the heading, the link and the hashtags are never
 * truncated, because a half-heading misquotes the paper and a half-URL is
 * broken. Across all fourteen published articles this trimming never fired —
 * longest post 304 characters — so it exists for a future long intro rather
 * than for anything written so far.
 */
function composeToot(article, options = {}) {
  const {
    baseHashtags = [],
    maxCategories = 2,
    maxTags = 3,
    limit = LIMIT,
  } = options;

  const hashtags = buildHashtags(
    { categories: article.categories, tags: article.tags },
    { base: baseHashtags, maxCategories, maxTags },
  );
  const hashtagLine = renderHashtags(hashtags);
  const heading = article.walled ? `${LOCK} ${article.heading}` : article.heading;

  // Everything except the intro is fixed cost. Joining the surviving paragraphs
  // (rather than always emitting four) keeps an article with no intro from
  // posting a stray blank line.
  const fixedParts = [heading, article.url, hashtagLine].filter(Boolean);
  const fixedWeight = weigh(fixedParts.join("\n\n"), [article.url]);
  // Each paragraph the intro sits between costs its own blank-line separator.
  const separators = article.intro ? 2 : 0;
  const budget = limit - fixedWeight - separators;

  let intro = article.intro || "";
  let truncated = false;
  if (intro && weigh(intro) > budget) {
    intro = trimToWord(intro, budget);
    truncated = true;
  }

  const text = [heading, intro, article.url, hashtagLine]
    .filter(Boolean)
    .join("\n\n");

  return {
    text,
    chars: weigh(text, [article.url]),
    truncated,
    hashtags,
  };
}

module.exports = { composeToot, weigh, trimToWord, LIMIT, URL_WEIGHT, LOCK };
