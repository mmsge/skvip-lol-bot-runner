// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, tally, DEFAULT_SKIP_HEADING_PATTERN } = require("../lib/filters");
const { makeArticle } = require("../lib/article");

const NOW = Date.parse("2026-08-25T10:00:00.000Z");

const config = {
  visibility: "public",
  noindexPolicy: "skip",
  maxArticleAgeHours: 72,
  skipHeadingPattern: new RegExp(DEFAULT_SKIP_HEADING_PATTERN, "iu"),
};

const article = (over = {}) =>
  makeArticle({
    id: "id-1",
    publishedAt: "2026-08-24T21:39:00.000Z",
    heading: "Ei heilt vanleg sak",
    intro: "Med ein ingress.",
    slug: "ei-heilt-vanleg-sak",
    url: "https://www.vestlendingen.no/artikler/ei-heilt-vanleg-sak",
    source: "sanity",
    ...over,
  });

test("a fresh, indexable article posts", () => {
  const ev = evaluate(article(), config, { now: NOW });
  assert.deepEqual(ev.reasons, []);
  assert.equal(ev.post, true);
  assert.equal(ev.visibility, "public");
});

test("holds an article past the age window", () => {
  const ev = evaluate(article({ publishedAt: "2026-06-21T04:00:00.000Z" }), config, { now: NOW });
  assert.deepEqual(ev.reasons, ["too-old"]);
});

test("holds an article already seen", () => {
  const ev = evaluate(article(), config, { now: NOW, isSeen: () => true });
  assert.deepEqual(ev.reasons, ["seen"]);
});

test("ignoreSeen and ignoreAge are what the dry run uses", () => {
  const ev = evaluate(article({ publishedAt: "2026-06-21T04:00:00.000Z" }), config, {
    now: NOW,
    isSeen: () => true,
    ignoreAge: true,
    ignoreSeen: true,
  });
  assert.deepEqual(ev.reasons, []);
});

test("holds an article with no heading rather than posting a blank status", () => {
  const ev = evaluate(article({ heading: "   " }), config, { now: NOW });
  assert.ok(ev.reasons.includes("no-heading"));
});

test("holds an article with an unparseable date", () => {
  const ev = evaluate(article({ publishedAt: "ikkje ein dato" }), config, { now: NOW });
  assert.deepEqual(ev.reasons, ["no-date"]);
});

test("skips the daily briefs by heading, in both written traditions", () => {
  for (const heading of [
    "Torsdag 20. august",
    "Fredag 21. august",
    "Måndag 1. januar",
    "Mandag 1. januar",
    "Tysdag 3. mars",
    "Tirsdag 3. mars",
    "Laurdag 12. desember",
    "Lørdag 12. desember",
    "Sundag 2. februar",
    "Søndag 2. februar",
  ]) {
    const ev = evaluate(article({ heading }), config, { now: NOW });
    assert.ok(ev.reasons.includes("daily-brief"), `${heading} should be a daily brief`);
  }
});

test("does not eat real articles that merely start with a weekday", () => {
  // The rule matches the heading in full; a category rule would have silenced
  // `aktuelt`, which also holds real reporting (ADR 0005).
  for (const heading of [
    "Torsdag 20. august vart det klart at bybanen kjem",
    "Fredag er den nye laurdagen",
    "20. august",
    "Sjå bilete frå lanseringa av Vestlendingen",
  ]) {
    const ev = evaluate(article({ heading }), config, { now: NOW });
    assert.ok(!ev.reasons.includes("daily-brief"), `${heading} is a real article`);
  }
});

test("noindex policy skip holds the article", () => {
  const ev = evaluate(article({ noindex: true }), config, { now: NOW });
  assert.deepEqual(ev.reasons, ["noindex"]);
});

test("noindex policy unlisted posts it quietly instead", () => {
  const ev = evaluate(article({ noindex: true }), { ...config, noindexPolicy: "unlisted" }, { now: NOW });
  assert.deepEqual(ev.reasons, []);
  assert.equal(ev.visibility, "unlisted");
});

test("noindex policy post treats it as any other article", () => {
  const ev = evaluate(article({ noindex: true }), { ...config, noindexPolicy: "post" }, { now: NOW });
  assert.deepEqual(ev.reasons, []);
  assert.equal(ev.visibility, "public");
});

test("a walled article is posted, not held", () => {
  const ev = evaluate(article({ walled: true }), config, { now: NOW });
  assert.deepEqual(ev.reasons, [], "the lock prefix is the answer, not a skip");
});

test("reasons overlap rather than collapsing", () => {
  // "Torsdag 20. august" is the one article on the corpus that is both.
  const ev = evaluate(article({ heading: "Torsdag 20. august", noindex: true }), config, { now: NOW });
  assert.deepEqual(ev.reasons.sort(), ["daily-brief", "noindex"]);
});

test("tally counts every reason, including overlapping ones", () => {
  const counts = tally([
    { reasons: ["noindex"] },
    { reasons: ["noindex", "daily-brief"] },
    { reasons: ["daily-brief"] },
  ]);
  assert.deepEqual(counts, { noindex: 2, "daily-brief": 2 });
});
