// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The primary source: the paper's own Sanity dataset.
 *
 * vestlendingen.no has no RSS or Atom feed — `/rss`, `/feed`, `/atom.xml` and
 * the rest are all absent, and there is no `<link rel="alternate">` anywhere in
 * the markup. What it does have is a Sanity dataset (`6bxsir9v/production`) that
 * the publisher has deliberately set public, holding the full structured
 * document for every article. One GROQ query per cycle returns everything a post
 * needs: 96 requests a day, and no HTML parsing at all.
 *
 * Manners, and why they are not optional (ADR 0002):
 *
 *   - the CDN endpoint (`apicdn`), never the origin API;
 *   - one request per cycle, with the robot's User-Agent;
 *   - only the fields a post needs. The article `body` is right there in the
 *     dataset and is deliberately not requested.
 *
 * The field names are the ones probing established, not the ones a schema guess
 * would produce: the headline is `heading` and the lead is `intro`, NOT `title`
 * and `description`, and the label on a category or tag document is `name`.
 */
const { fetchJson, userAgent } = require("./http");
const { makeArticle, articleUrl, byNewest } = require("./article");

const SOURCE = "sanity";

/**
 * `publishedAt <= now()` excludes anything scheduled; the drafts path exclusion
 * is belt-and-braces, since the public dataset exposes no drafts anyway.
 *
 * The order is `publishedAt desc, _id desc` rather than `publishedAt desc`
 * alone. Four articles share `2026-08-19T20:00:00Z` and two more share
 * `2026-08-24T21:39:00Z`, so the timestamp is not a total order and an
 * unbroken tie could come back in a different order on a retry (ADR 0003).
 */
function buildQuery(limit) {
  return `*[_type == "article"
  && !(_id in path("drafts.**"))
  && defined(publishedAt)
  && publishedAt <= now()
] | order(publishedAt desc, _id desc)[0...${limit}]{
  _id, publishedAt, _updatedAt, access, heading, intro,
  "slug": slug.current,
  "noindex": robots.noindex,
  "categories": categories[]->{ "slug": slug.current, "name": name, "noindex": robots.noindex },
  "tags":       tags[]->{ "slug": slug.current, "name": name, "noindex": robots.noindex },
  "image": mainImage{ altText, caption, "ref": asset._ref },
  "walled": paywallContentOverrides.enabled == true
         || registrationWallContentOverrides.enabled == true
}`;
}

function endpoint({ projectId, dataset, apiVersion }, query) {
  const url = new URL(
    `https://${projectId}.apicdn.sanity.io/${apiVersion}/data/query/${dataset}`,
  );
  url.searchParams.set("query", query);
  return url.toString();
}

/**
 * Map one Sanity document onto the shared Article shape.
 *
 * `access` is `OPEN` on thirteen articles and `FREE` on one, and both mean open
 * today; every paywall and registration-wall override is disabled. Anything
 * else, or either override flag turning true, counts as walled — which prefixes
 * the post rather than skipping it.
 */
function toArticle(doc, origin) {
  const openAccess = doc.access == null || ["OPEN", "FREE"].includes(String(doc.access).toUpperCase());
  return makeArticle({
    id: doc._id,
    publishedAt: doc.publishedAt,
    updatedAt: doc._updatedAt,
    heading: doc.heading,
    intro: doc.intro,
    slug: doc.slug,
    url: articleUrl(origin, doc.slug),
    noindex: doc.noindex === true,
    walled: doc.walled === true || !openAccess,
    categories: doc.categories,
    tags: doc.tags,
    image: doc.image,
    source: SOURCE,
  });
}

/**
 * Fetch the most recent articles. Throws on anything unexpected — a 401, a 403,
 * or a payload that no longer parses — so the poller can fall back for that
 * cycle instead of posting a half-read article.
 */
async function fetchArticles(config, { limit = 20, publicBaseUrl = "" } = {}) {
  const url = endpoint(config.sanity, buildQuery(limit));
  const payload = await fetchJson(url, {
    headers: { "user-agent": userAgent(config.slug, publicBaseUrl), accept: "application/json" },
  });

  if (!payload || !Array.isArray(payload.result)) {
    throw new Error("sanity response has no result array — the dataset shape changed");
  }
  return payload.result
    .filter((doc) => doc && doc._id && doc.slug)
    .map((doc) => toArticle(doc, config.sourceOrigin))
    .sort(byNewest);
}

module.exports = { fetchArticles, buildQuery, endpoint, toArticle, SOURCE };
