// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require("node:test");
const assert = require("node:assert/strict");
const { renderFeed, toFeedItem, rfc822, xmlEscape } = require("../lib/feed");
const { makeArticle } = require("../lib/article");
const descriptor = require("../bots/vestlendingen");

const article = makeArticle({
  id: "675480b2-54e4-4e7f-9076-f059a824aef6",
  publishedAt: "2026-08-24T21:39:00.000Z",
  heading: "– Heimekontor-forbod: Ein gåvepakke til Oslo-staten",
  intro: "Du får ikkje dei beste folka ved å tvinge dei inn til Oslo-kontoret.",
  slug: "heimekontor-forbod-ein-gavepakke-til-oslo-staten",
  url: "https://www.vestlendingen.no/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten",
  categories: [{ name: "Kommentar" }],
  tags: [{ name: "Samferdsel" }],
  source: "sanity",
});

const feed = (items) =>
  renderFeed({
    bot: descriptor,
    items,
    selfUrl: "https://mastobots.skvip.lol/vestlendingen/rss.xml",
    siteUrl: "https://mastobots.skvip.lol/vestlendingen/",
    updatedAt: "2026-08-25T10:00:00.000Z",
  });

test("renders a well-formed RSS 2.0 channel", () => {
  const xml = feed([toFeedItem(article)]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /<atom:link href="[^"]+rss\.xml" rel="self"/);
  assert.match(xml, /<language>no<\/language>/);
  assert.match(xml, /<lastBuildDate>Tue, 25 Aug 2026 10:00:00 GMT<\/lastBuildDate>/);
});

test("uses RFC 822 dates, as RSS requires — not ISO 8601", () => {
  const xml = feed([toFeedItem(article)]);
  assert.match(xml, /<pubDate>Mon, 24 Aug 2026 21:39:00 GMT<\/pubDate>/);
  assert.ok(!xml.includes("2026-08-24T21:39"));
});

test("the guid is the article id, not the URL", () => {
  // A slug rewrite must not orphan an item a reader has already seen (ADR 0003).
  const xml = feed([toFeedItem(article)]);
  assert.match(xml, /<guid isPermaLink="false">675480b2-54e4-4e7f-9076-f059a824aef6<\/guid>/);
});

test("carries categories and tags as <category>", () => {
  const xml = feed([toFeedItem(article)]);
  assert.match(xml, /<category>Kommentar<\/category>/);
  assert.match(xml, /<category>Samferdsel<\/category>/);
});

test("escapes XML metacharacters in a heading", () => {
  const nasty = { ...toFeedItem(article), title: 'Ei sak om <b>"AT&T"</b>' };
  const xml = feed([nasty]);
  assert.ok(xml.includes("&lt;b&gt;"));
  assert.ok(xml.includes("&amp;T"));
  assert.ok(!xml.includes("<b>"));
});

test("an empty feed is still a valid document", () => {
  const xml = feed([]);
  assert.match(xml, /<channel>/);
  assert.ok(!xml.includes("<item>"));
});

test("an item with an unparseable date simply omits pubDate", () => {
  const xml = feed([{ ...toFeedItem(article), publishedAt: "ikkje ein dato" }]);
  assert.ok(!xml.includes("<pubDate>"));
  assert.match(xml, /<item>/);
});

test("rfc822 rejects nonsense rather than emitting Invalid Date", () => {
  assert.equal(rfc822("tull"), null);
  assert.equal(rfc822("2026-08-24T21:39:00.000Z"), "Mon, 24 Aug 2026 21:39:00 GMT");
});

test("xmlEscape covers all five metacharacters", () => {
  assert.equal(xmlEscape(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
});

// ----------------------------------------------------------------- pages ----

test("the index and bot pages carry the git-derived page dates", async () => {
  const { renderIndex, renderBotPage, renderSitemap, renderLlms } = require("../server");
  const entry = {
    bot: descriptor,
    config: { pollIntervalMinutes: 15, noindexPolicy: "skip", language: "no" },
    store: { recent: [toFeedItem(article)], lastCycle: null, seenArticles: 0, deferredArticles: 0, deferred: new Map(), seen: new Map() },
  };

  for (const html of [renderIndex([entry]), renderBotPage(entry)]) {
    assert.match(html, /<meta name="date" content="[^"]+">/);
    assert.match(html, /<meta name="last-modified" content="[^"]+">/);
    assert.match(html, /article:published_time/);
    assert.match(html, /article:modified_time/);
    assert.match(html, /"dateModified"/);
    assert.match(html, /<link rel="canonical"/);
    assert.match(html, /<html lang="nn">/);
  }

  assert.match(
    renderBotPage(entry),
    /<link rel="alternate" type="application\/rss\+xml"/,
    "the feed must be discoverable from the page",
  );
  assert.match(renderSitemap([entry]), /<lastmod>/);
  assert.match(renderLlms([entry]), /^# mastobots/);
});

test("the sitemap lists the index and every bot page", () => {
  const { renderSitemap } = require("../server");
  const entry = { bot: descriptor };
  const xml = renderSitemap([entry]);
  assert.match(xml, /<loc>https:\/\/mastobots\.skvip\.lol\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mastobots\.skvip\.lol\/vestlendingen\/<\/loc>/);
});
