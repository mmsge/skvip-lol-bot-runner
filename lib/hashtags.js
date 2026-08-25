// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Hashtags, spelled the way the publisher spells them.
 *
 * The label text comes from the `name` field on the paper's own category and tag
 * documents, so `Sjømat og havbruk` becomes `#SjømatOgHavbruk` and `Ålesund`
 * stays `#Ålesund`, accents and all. An earlier revision of the plan carried a
 * transliteration table for this; probing the dataset made it unnecessary, and a
 * table we maintain is a table that goes stale the first time the paper invents
 * a category (ADR 0006).
 */

// Mastodon accepts letters, digits and underscore in a hashtag, and rejects one
// that is all digits. Splitting on everything else is what turns punctuation
// ("Heimekontor-forbod", "Sjømat og havbruk") into word boundaries to CamelCase
// across, rather than characters to smuggle into a tag that would not render.
const WORD = /[\p{L}\p{N}_]+/gu;

/**
 * CamelCase one publisher label into a hashtag body, without the `#`.
 *
 * Returns null when nothing usable survives — an empty label, punctuation only,
 * or an all-digit result that Mastodon would not accept as a tag.
 */
function toHashtag(name) {
  const words = String(name || "").match(WORD);
  if (!words) return null;
  // Upper-case the first character only. The rest of each word is left exactly
  // as the paper wrote it, so an intentional inner capital survives.
  const body = words
    .map((w) => [...w][0].toUpperCase() + [...w].slice(1).join(""))
    .join("");
  if (!body || /^\p{N}+$/u.test(body)) return null;
  return body;
}

/**
 * Build the hashtag line for one article.
 *
 * Order is fixed and meaningful:
 *
 *   1. the base tags, used VERBATIM — that is what keeps `#nyhende` lower case
 *      while every derived tag is CamelCased;
 *   2. the article's category, which always makes the post;
 *   3. its tags, capped at `maxTags`.
 *
 * Categories and tags are capped separately on purpose. Only one article on the
 * corpus carries tags at all, and it carries five; capping the two together
 * would have let a tag-heavy article push its own section off the post. The
 * three-tag cap is what produced `#Vestlandet #nyhende #Kommentar #Samferdsel
 * #Haugesund #Stavanger` in the dry run, dropping `Bergen` and `Bompenger`.
 *
 * A label carrying its own `robots.noindex` is dropped — the paper marked that
 * term as one it does not want indexed, and a hashtag is an index.
 *
 * Deduplication is case-insensitive because Mastodon treats `#Kommentar` and
 * `#kommentar` as the same tag; posting both would render as a repeated word.
 */
function buildHashtags(
  { categories = [], tags = [] } = {},
  { base = [], maxCategories = 2, maxTags = 3 } = {},
) {
  const out = [];
  const seen = new Set();

  const push = (tag) => {
    if (!tag) return false;
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(tag);
    return true;
  };

  // Base tags are the author's own spelling and bypass CamelCasing entirely.
  for (const b of base) push(String(b).replace(/^#/, "").trim() || null);

  const take = (labels, limit) => {
    let taken = 0;
    for (const label of labels) {
      if (taken >= limit) break;
      if (label.noindex) continue;
      if (push(toHashtag(label.name))) taken += 1;
    }
  };

  take(categories, maxCategories);
  take(tags, maxTags);

  return out;
}

/** Render hashtag bodies as the `#a #b #c` line that goes into the post. */
function renderHashtags(tags) {
  return tags.map((t) => `#${t}`).join(" ");
}

module.exports = { toHashtag, buildHashtags, renderHashtags };
