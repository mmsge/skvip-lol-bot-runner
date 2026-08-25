// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Fixture-pinned source tests.
 *
 * The fixtures are captured from the live dataset and live article pages. If
 * Subrite renames `heading` or `intro`, or moves the JSON-LD out of the flight
 * payload, these fail loudly rather than the robot going quiet — which is the
 * mitigation the plan's risk table names.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sanity = require("../lib/source-sanity");
const sitemap = require("../lib/source-sitemap");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const CORPUS = JSON.parse(fixture("sanity-corpus.json")).result;
const ORIGIN = "https://www.vestlendingen.no";

// ---------------------------------------------------------------- sanity ----

test("the GROQ query never asks for the article body", () => {
  // It is right there in the dataset, and reading it would be taking more than
  // the post needs (ADR 0002).
  const query = sanity.buildQuery(20);
  assert.ok(!/\bbody\b/.test(query));
});

test("the GROQ query breaks ordering ties on _id", () => {
  assert.match(sanity.buildQuery(20), /order\(publishedAt desc, _id desc\)/);
});

test("the endpoint is the CDN, never the origin API", () => {
  const url = sanity.endpoint(
    { projectId: "6bxsir9v", dataset: "production", apiVersion: "v2021-10-21" },
    "*",
  );
  assert.ok(url.startsWith("https://6bxsir9v.apicdn.sanity.io/"));
});

test("maps the corpus onto the shared article shape", () => {
  const article = sanity.toArticle(
    CORPUS.find((d) => d.heading.startsWith("– Heimekontor")),
    ORIGIN,
  );
  assert.equal(article.id, "675480b2-54e4-4e7f-9076-f059a824aef6");
  assert.equal(article.heading, "– Heimekontor-forbod: Ein gåvepakke til Oslo-staten");
  assert.equal(
    article.intro,
    "Du får ikkje dei beste folka ved å tvinge dei inn til Oslo-kontoret, skriv Alfred Bjørlo.",
  );
  assert.equal(article.url, `${ORIGIN}/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten`);
  assert.deepEqual(article.categories.map((c) => c.name), ["Kommentar"]);
  assert.equal(article.noindex, false);
  assert.equal(article.walled, false);
  assert.equal(article.source, "sanity");
});

test("the corpus still has heading and intro on every article", () => {
  for (const doc of CORPUS) {
    const article = sanity.toArticle(doc, ORIGIN);
    assert.ok(article.heading, `missing heading on ${doc._id}`);
    assert.ok(article.intro, `missing intro on ${doc._id}`);
  }
});

test("reads robots.noindex off the article, and five carry it", () => {
  const flagged = CORPUS.map((d) => sanity.toArticle(d, ORIGIN)).filter((a) => a.noindex);
  assert.equal(flagged.length, 5);
});

test("OPEN and FREE both mean open today", () => {
  const values = new Set(CORPUS.map((d) => d.access));
  assert.deepEqual([...values].sort(), ["FREE", "OPEN"]);
  assert.equal(
    CORPUS.map((d) => sanity.toArticle(d, ORIGIN)).filter((a) => a.walled).length,
    0,
  );
});

test("an unknown access value counts as walled", () => {
  const doc = { ...CORPUS[0], access: "SUBSCRIBER" };
  assert.equal(sanity.toArticle(doc, ORIGIN).walled, true);
});

test("either override flag turning true counts as walled", () => {
  assert.equal(sanity.toArticle({ ...CORPUS[0], walled: true }, ORIGIN).walled, true);
});

// --------------------------------------------------------------- sitemap ----

test("parses the article sitemap newest first", () => {
  const entries = sitemap.parseSitemap(fixture("sitemap.xml"));
  assert.equal(entries.length, 14);
  assert.ok(entries[0].loc.startsWith("https://www.vestlendingen.no/artikler/"));
  const times = entries.map((e) => Date.parse(e.lastmod));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("sitemap lastmod agrees with the dataset publishedAt", () => {
  // The two agree on every article probed, which is what lets the fallback key
  // the age filter off lastmod (ADR 0003).
  const entries = sitemap.parseSitemap(fixture("sitemap.xml"));
  const bySlug = new Map(entries.map((e) => [sitemap.slugFromUrl(e.loc), e.lastmod]));
  for (const doc of CORPUS) {
    if (!bySlug.has(doc.slug)) continue;
    assert.equal(bySlug.get(doc.slug), doc.publishedAt, `mismatch on ${doc.slug}`);
  }
});

test("decodes XML entities in a sitemap loc", () => {
  const entries = sitemap.parseSitemap(
    "<urlset><url><loc>https://e.no/a?b=1&amp;c=2</loc></url></urlset>",
  );
  assert.equal(entries[0].loc, "https://e.no/a?b=1&c=2");
});

test("reads the JSON-LD out of the Next.js flight payload", () => {
  const article = sitemap.parseArticlePage(fixture("article-open.html"), {
    url: `${ORIGIN}/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten`,
    lastmod: null,
  });
  assert.equal(article.heading, "– Heimekontor-forbod: Ein gåvepakke til Oslo-staten");
  assert.equal(
    article.intro,
    "Du får ikkje dei beste folka ved å tvinge dei inn til Oslo-kontoret, skriv Alfred Bjørlo.",
  );
  assert.equal(article.publishedAt, "2026-08-24T21:39:00.000Z");
  assert.deepEqual(article.categories.map((c) => c.name), ["Kommentar"]);
  assert.equal(article.source, "sitemap");
});

test("the fallback recovers the SAME id the primary source uses", () => {
  // Without this an outage would repost everything the primary already handled.
  const article = sitemap.parseArticlePage(fixture("article-open.html"), {
    url: `${ORIGIN}/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten`,
    lastmod: null,
  });
  assert.equal(article.id, "675480b2-54e4-4e7f-9076-f059a824aef6");
  assert.ok(CORPUS.some((d) => d._id === article.id));
});

test("the fallback can see robots.noindex", () => {
  // The article page carries <meta name="robots" content="noindex"> on exactly
  // the articles whose Sanity flag is set. Without it, a Sanity outage would
  // start posting the articles ADR 0004 holds back.
  const flagged = sitemap.parseArticlePage(fixture("article-noindex.html"), {
    url: `${ORIGIN}/artikler/rogfast-vil-revolusjonere-vestlandet-men-bilistene-betaler-en-urimelig-hoy-pris`,
    lastmod: null,
  });
  assert.equal(flagged.noindex, true);

  const open = sitemap.parseArticlePage(fixture("article-open.html"), {
    url: `${ORIGIN}/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten`,
    lastmod: null,
  });
  assert.equal(open.noindex, false);
});

test("the fallback loses article tags, and says so by carrying none", () => {
  const article = sitemap.parseArticlePage(fixture("article-noindex.html"), {
    url: `${ORIGIN}/artikler/rogfast-vil-revolusjonere-vestlandet-men-bilistene-betaler-en-urimelig-hoy-pris`,
    lastmod: null,
  });
  // The JSON-LD has articleSection but no keywords, even on the one article
  // with five tags. A thinner post, not a wrong one.
  assert.deepEqual(article.tags, []);
  assert.deepEqual(article.categories.map((c) => c.name), ["Kommentar"]);
});

test("falls back to the markup when the JSON-LD is gone", () => {
  const html = `<html><head></head><body>
    <h1 class="text-3xl">Ei overskrift frå markup</h1>
    <p class="text-xl">Og ein ingress frå markup.</p>
  </body></html>`;
  const article = sitemap.parseArticlePage(html, { url: `${ORIGIN}/artikler/x`, lastmod: "2026-08-24T21:39:00.000Z" });
  assert.equal(article.heading, "Ei overskrift frå markup");
  assert.equal(article.intro, "Og ein ingress frå markup.");
  assert.equal(article.publishedAt, "2026-08-24T21:39:00.000Z", "lastmod covers the missing date");
  assert.equal(article.id, "slug:x", "no uuid to recover, so the slug key stands in");
});

test("a page with neither JSON-LD nor an h1 yields nothing", () => {
  assert.equal(sitemap.parseArticlePage("<html><body>tomt</body></html>", { url: `${ORIGIN}/artikler/x` }), null);
});

test("id recovery refuses to guess when the page has several uuids", () => {
  const many = "a".repeat(0) +
    "11111111-1111-1111-1111-111111111111 22222222-2222-2222-2222-222222222222";
  assert.equal(sitemap.extractId(many), null);
});

test("the fallback fetches only pages it does not already know", async () => {
  const fetched = [];
  const entries = sitemap.parseSitemap(fixture("sitemap.xml"));
  const known = new Set(entries.slice(2).map((e) => `slug:${sitemap.slugFromUrl(e.loc)}`));

  const config = { slug: "bot", sourceSitemap: "https://example.com/sitemap.xml" };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === config.sourceSitemap) return new Response(fixture("sitemap.xml"), { status: 200 });
    fetched.push(url);
    return new Response(fixture("article-open.html"), { status: 200 });
  };
  try {
    await sitemap.fetchArticles(config, {
      isKnown: (loc, slug) => known.has(`slug:${slug}`),
      maxFetch: 5,
      spacingMs: 0,
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetched.length, 2, "twelve of fourteen were already known");
});
