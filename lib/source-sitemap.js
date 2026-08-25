// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The fallback source: the article sitemap, plus the article pages themselves.
 *
 * If the Sanity query returns 401, 403, or a shape that no longer parses, the
 * cycle flips to this path and keeps going. It is slower and more brittle —
 * which is exactly why it is the fallback — but it means no single upstream
 * decision can silence the robot (ADR 0002).
 *
 * It also uses only what the paper's `robots.txt` explicitly invites: that file
 * is `Allow: /` with `Disallow:` on `/_next/`, `/api/` and `/auth/`, none of
 * which this touches.
 *
 * Three things are read from each article page, in descending order of quality:
 *
 *   1. the JSON-LD `Article` node, which carries `headline`, `description`
 *      (the intro, verbatim), `datePublished` and `articleSection`. It is not in
 *      a `<script type="application/ld+json">` tag — the served HTML has none.
 *      It sits inside the Next.js flight payload, escaped one level deep, so it
 *      has to be unescaped before it will parse;
 *   2. `<meta name="robots" content="noindex">`, which is present on exactly the
 *      articles whose Sanity `robots.noindex` is true. Without it the fallback
 *      could not honour the noindex decision and a Sanity outage would start
 *      posting the articles ADR 0004 says to hold back;
 *   3. `<h1>` plus the following `<p class="text-xl">`, if the JSON-LD is gone.
 *
 * What it cannot recover is article TAGS: the JSON-LD carries `articleSection`
 * (the category) but no `keywords`, even on the one article that has five tags.
 * A fallback post therefore gets base hashtags plus the category and no more —
 * a thinner post, not a wrong one.
 */
const { fetchText, userAgent } = require("./http");
const { makeArticle, byNewest } = require("./article");

const SOURCE = "sitemap";
// The article page carries exactly one UUID-shaped string, and it is the Sanity
// document `_id` — the same key the primary source uses. Recovering it is what
// keeps a fallback cycle from reposting an article the primary already handled.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const FLIGHT_CHUNK = /self\.__next_f\.push\(\[1\s*,\s*("(?:[^"\\]|\\.)*")\]\)/g;

/** Parse `<loc>`/`<lastmod>` pairs out of a sitemap, newest first. */
function parseSitemap(xml) {
  const entries = [];
  const blocks = String(xml).match(/<url\b[\s\S]*?<\/url>/gi) || [];
  for (const block of blocks) {
    const loc = (block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
    if (!loc) continue;
    const lastmod = (block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1] || null;
    entries.push({ loc: decodeEntities(loc), lastmod: lastmod ? decodeEntities(lastmod) : null });
  }
  return entries.sort((a, b) => {
    const ta = Date.parse(a.lastmod || 0) || 0;
    const tb = Date.parse(b.lastmod || 0) || 0;
    if (ta !== tb) return tb - ta;
    return a.loc < b.loc ? 1 : a.loc > b.loc ? -1 : 0;
  });
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Concatenate and unescape the Next.js flight payload chunks. */
function flightPayload(html) {
  let out = "";
  FLIGHT_CHUNK.lastIndex = 0;
  let match;
  while ((match = FLIGHT_CHUNK.exec(html))) {
    try {
      out += JSON.parse(match[1]);
    } catch {
      // A chunk we cannot unescape is a chunk we skip; the JSON-LD may still be
      // in one of the others.
    }
  }
  return out;
}

/**
 * Pull one balanced JSON object out of `text`, starting from the `{` that opens
 * the object containing `markerIndex`. Brace-counting rather than a regex,
 * because the payload is one long string and the object nests.
 */
function sliceObject(text, markerIndex) {
  const start = text.lastIndexOf("{", markerIndex);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (escaped) {
      escaped = false;
    } else if (c === "\\") {
      escaped = true;
    } else if (c === '"') {
      inString = !inString;
    } else if (!inString) {
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** The JSON-LD Article node, or null. */
function extractArticleLd(payload) {
  for (const marker of ['"@type":"Article"', '"@type":"NewsArticle"']) {
    const at = payload.indexOf(marker);
    if (at < 0) continue;
    const body = sliceObject(payload, at);
    if (!body) continue;
    try {
      return JSON.parse(body);
    } catch {
      // fall through and try the next marker
    }
  }
  return null;
}

/** True when the page asks search engines not to index it. */
function extractNoindex(html) {
  const tags = String(html).match(/<meta[^>]+name=["']robots["'][^>]*>/gi) || [];
  return tags.some((tag) => /content=["'][^"']*\bnoindex\b/i.test(tag));
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, " "));
}

/**
 * Last-resort reader: the visible heading and lead.
 *
 * Only consulted when the JSON-LD is missing, which on a Next.js rewrite is the
 * most likely single thing to break.
 */
function extractFromMarkup(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1) return null;
  const after = html.slice(h1.index + h1[0].length);
  const lead = after.match(/<p\b[^>]*class=["'][^"']*\btext-xl\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  return {
    heading: stripTags(h1[1]),
    intro: lead ? stripTags(lead[1]) : "",
  };
}

/** Recover the Sanity `_id` from the page, or null if it is not there. */
function extractId(payload) {
  UUID.lastIndex = 0;
  const found = [...new Set(payload.match(UUID) || [])];
  return found.length === 1 ? found[0] : null;
}

function slugFromUrl(url) {
  const parts = String(url).split("?")[0].split("#")[0].replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || "";
}

/** Turn one fetched article page into an Article. */
function parseArticlePage(html, { url, lastmod }) {
  const payload = flightPayload(html);
  const ld = extractArticleLd(payload);
  const markup = ld ? null : extractFromMarkup(html);
  if (!ld && !markup) return null;

  const slug = slugFromUrl(url);
  const recoveredId = extractId(payload);
  const sections = ld && ld.articleSection
    ? [].concat(ld.articleSection).filter(Boolean)
    : [];

  return makeArticle({
    // Prefer the recovered `_id` so an article handled by the primary source is
    // recognised here; the slug key is the safety net either way.
    id: recoveredId || `slug:${slug}`,
    publishedAt: (ld && ld.datePublished) || lastmod || null,
    updatedAt: (ld && ld.dateModified) || null,
    heading: (ld && ld.headline) || (markup && markup.heading) || "",
    intro: (ld && ld.description) || (markup && markup.intro) || "",
    slug,
    url,
    noindex: extractNoindex(html),
    // Nothing on the page states the wall status, and guessing it wrong in
    // either direction is worse than the honest default: the primary source is
    // what reads `access` and the override flags.
    walled: false,
    categories: sections.map((name) => ({ name })),
    tags: [],
    image: null,
    source: SOURCE,
  });
}

/**
 * Fetch recent articles the fallback way.
 *
 * `isKnown` lets the poller say which URLs it has already handled, so a normal
 * fallback cycle fetches nothing at all rather than pulling fourteen article
 * pages to rediscover what it already knows. `maxFetch` caps the rest.
 */
async function fetchArticles(config, options = {}) {
  const {
    isKnown = () => false,
    maxFetch = 5,
    publicBaseUrl = "",
    spacingMs = 500,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = options;

  const headers = { "user-agent": userAgent(config.slug, publicBaseUrl) };
  const xml = await fetchText(config.sourceSitemap, { headers });
  const entries = parseSitemap(xml);
  if (!entries.length) throw new Error("sitemap contained no <loc> entries");

  const wanted = entries.filter((e) => !isKnown(e.loc, slugFromUrl(e.loc))).slice(0, maxFetch);

  const articles = [];
  for (const [i, entry] of wanted.entries()) {
    // One page at a time, spaced. This path exists for an outage, not for
    // throughput, and hammering the paper's origin during one is bad manners.
    if (i > 0 && spacingMs) await sleep(spacingMs);
    const html = await fetchText(entry.loc, { headers });
    const article = parseArticlePage(html, { url: entry.loc, lastmod: entry.lastmod });
    if (article && article.heading) articles.push(article);
  }
  return articles.sort(byNewest);
}

module.exports = {
  fetchArticles,
  parseSitemap,
  parseArticlePage,
  flightPayload,
  extractArticleLd,
  extractNoindex,
  extractFromMarkup,
  extractId,
  slugFromUrl,
  SOURCE,
};
