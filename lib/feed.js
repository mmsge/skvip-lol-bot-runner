// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RSS 2.0 — the feed vestlendingen.no does not have.
 *
 * The paper publishes no RSS or Atom feed of its own: `/rss`, `/rss.xml`,
 * `/feed`, `/feed.xml`, `/atom.xml` and `/artikler/rss` are all 404 or absent,
 * and there is no `<link rel="alternate">` anywhere in its markup. The robot has
 * to normalise every article into a structured shape anyway in order to compose
 * a post, so serving that shape as a feed costs almost nothing — and it is
 * useful whether or not the Mastodon side works out.
 *
 * The feed carries what the robot posts, which is not quite what the paper
 * publishes: articles held by the noindex policy are absent from both. See
 * `Store#rememberForFeed`.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function xmlEscape(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** RFC 822 date, as RSS 2.0 requires — not ISO 8601. */
function rfc822(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

/** Reduce an Article to the fields the feed needs. */
function toFeedItem(article) {
  return {
    id: article.id,
    title: article.heading,
    description: article.intro,
    link: article.url,
    publishedAt: article.publishedAt,
    categories: [
      ...(article.categories || []).map((c) => c.name),
      ...(article.tags || []).map((t) => t.name),
    ],
  };
}

function renderItem(item) {
  const parts = [
    `      <title>${xmlEscape(item.title)}</title>`,
    `      <link>${xmlEscape(item.link)}</link>`,
    // The article id, not the URL — a slug rewrite must not orphan an item that
    // readers have already seen (ADR 0003).
    `      <guid isPermaLink="false">${xmlEscape(item.id)}</guid>`,
  ];
  if (item.description) parts.push(`      <description>${xmlEscape(item.description)}</description>`);
  const pub = rfc822(item.publishedAt);
  if (pub) parts.push(`      <pubDate>${pub}</pubDate>`);
  for (const category of item.categories || []) {
    if (category) parts.push(`      <category>${xmlEscape(category)}</category>`);
  }
  return `    <item>\n${parts.join("\n")}\n    </item>`;
}

/**
 * Render one bot's feed.
 *
 * `selfUrl` is the feed's own address and `siteUrl` the page it belongs to;
 * `atom:link rel="self"` is what lets a reader that was handed the XML directly
 * find its way back.
 */
function renderFeed({ bot, items, selfUrl, siteUrl, language = "no", updatedAt = null }) {
  const meta = bot.feed || {};
  const lastBuild = rfc822(updatedAt || new Date().toISOString());
  const head = [
    `    <title>${xmlEscape(meta.title || bot.title)}</title>`,
    `    <link>${xmlEscape(siteUrl)}</link>`,
    `    <description>${xmlEscape(meta.description || bot.summary || bot.title)}</description>`,
    `    <language>${xmlEscape(meta.language || language)}</language>`,
    `    <generator>mastobots</generator>`,
    `    <atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml"/>`,
  ];
  if (lastBuild) head.push(`    <lastBuildDate>${lastBuild}</lastBuildDate>`);

  const body = (items || []).map(renderItem).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
${head.join("\n")}
${body}
  </channel>
</rss>
`;
}

module.exports = { renderFeed, toFeedItem, xmlEscape, rfc822 };
