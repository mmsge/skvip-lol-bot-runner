// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which articles post, and why the rest do not.
 *
 * Every hold is a named reason, and an article can carry more than one — the
 * corpus's "Torsdag 20. august" is both a daily brief and noindex. Reasons are
 * counted rather than collapsed, so a rule that starts eating real articles is
 * visible in the logs before anyone notices the account has gone quiet.
 */

/**
 * The daily briefs.
 *
 * "Torsdag 20. august" and "Fredag 21. august" are link roundups whose entire
 * intro is "Dagens viktigste saker." As a toot they say nothing, and they carry
 * no image, so even the preview card would be bare.
 *
 * Matching the HEADING rather than the category is the whole point: the briefs
 * sit in `aktuelt`, which also holds real reporting, so a category rule would
 * have silenced the news section (ADR 0005). Both written traditions are
 * covered, because the paper publishes in both.
 */
const DEFAULT_SKIP_HEADING_PATTERN =
  "^(m[åa]ndag|tysdag|tirsdag|onsdag|torsdag|fredag|laurdag|l[øo]rdag|sundag|s[øo]ndag)\\s+\\d{1,2}\\.\\s+(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)$";

const NOINDEX_POLICIES = new Set(["skip", "unlisted", "post"]);

/**
 * Classify one article.
 *
 * Returns { post, reasons, visibility }. `reasons` is empty exactly when the
 * article posts. `visibility` is the configured default, downgraded to
 * `unlisted` when a noindex article is being posted under that policy.
 */
function evaluate(article, config, options = {}) {
  const {
    now = Date.now(),
    isSeen = null,
    ignoreAge = false,
    ignoreSeen = false,
  } = options;
  const reasons = [];

  // Nothing to say. A source that returned a shape we no longer understand
  // lands here rather than posting a blank status.
  if (!article.heading) reasons.push("no-heading");

  if (!ignoreSeen && isSeen && isSeen(article)) reasons.push("seen");

  if (!ignoreAge) {
    const published = Date.parse(article.publishedAt || "");
    if (Number.isNaN(published)) {
      reasons.push("no-date");
    } else if (now - published > config.maxArticleAgeHours * 3600 * 1000) {
      // An article edited months after publication must not resurface, and a
      // first run must not dump the archive into the timeline.
      reasons.push("too-old");
    }
  }

  if (config.skipHeadingPattern && config.skipHeadingPattern.test(article.heading)) {
    reasons.push("daily-brief");
  }

  // Five of fourteen articles carry robots.noindex, and they are not filler.
  // Either the flag is launch-window housekeeping nobody cleared, or it is
  // duplicate-content suppression on pieces republished from a partner — and if
  // it is the second, those are precisely the articles the paper least wants
  // mirrored. Skipping costs reach and is undone by flipping one variable;
  // posting cannot be undone from other people's timelines (ADR 0004).
  let visibility = config.visibility;
  if (article.noindex) {
    if (config.noindexPolicy === "skip") reasons.push("noindex");
    else if (config.noindexPolicy === "unlisted") visibility = "unlisted";
  }

  return { post: reasons.length === 0, reasons, visibility };
}

/** Tally reasons across a classified batch. Overlapping reasons both count. */
function tally(evaluations) {
  const counts = {};
  for (const ev of evaluations) {
    for (const reason of ev.reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

module.exports = { evaluate, tally, DEFAULT_SKIP_HEADING_PATTERN, NOINDEX_POLICIES };
