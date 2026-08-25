// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The dry run, pinned.
 *
 * These are the numbers from Appendix A of the plan, produced against the live
 * dataset on 25 August 2026 and reviewed before the robot was built. If a change
 * to the filters, the composer or the hashtag rules moves any of them, that is a
 * decision someone should be making on purpose.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sanity = require("../lib/source-sanity");
const { evaluate, tally } = require("../lib/filters");
const { composeToot, LIMIT } = require("../lib/toot");
const { prepare } = require("../lib/registry");
const descriptor = require("../bots/vestlendingen");

const CORPUS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "sanity-corpus.json"), "utf8"),
).result;

const { bot, config } = prepare(descriptor, { VESTLENDINGEN_MASTODON_TOKEN: "tok" });
const ARTICLES = CORPUS.map((doc) => sanity.toArticle(doc, config.sourceOrigin));
// The dry run ignores the age window and the seen store, exactly as bin/dryrun.js does.
const EVALUATIONS = ARTICLES.map((article) => ({
  article,
  ...evaluate(article, config, { ignoreAge: true, ignoreSeen: true }),
}));
const POSTABLE = EVALUATIONS.filter((e) => e.post);
const HELD = EVALUATIONS.filter((e) => !e.post);
const TOOTS = POSTABLE.map((e) => composeToot(e.article, bot.composer));

test("the corpus is the fourteen published articles", () => {
  assert.equal(ARTICLES.length, 14);
});

test("eight post and six are held", () => {
  assert.equal(POSTABLE.length, 8);
  assert.equal(HELD.length, 6);
});

test("five noindex, two daily briefs, overlapping on one", () => {
  assert.deepEqual(tally(HELD), { noindex: 5, "daily-brief": 2 });
  const both = HELD.filter((e) => e.reasons.length === 2);
  assert.equal(both.length, 1);
  assert.equal(both[0].article.heading, "Torsdag 20. august");
});

test("zero truncations, longest 304, shortest 125", () => {
  assert.equal(TOOTS.filter((t) => t.truncated).length, 0);
  assert.equal(Math.max(...TOOTS.map((t) => t.chars)), 304);
  assert.equal(Math.min(...TOOTS.map((t) => t.chars)), 125);
});

test("every post fits the budget with room to spare", () => {
  for (const toot of TOOTS) assert.ok(toot.chars <= LIMIT, `${toot.chars} > ${LIMIT}`);
});

test("every post carries the base hashtags plus its category", () => {
  for (const toot of TOOTS) {
    assert.equal(toot.hashtags[0], "Vestlandet");
    assert.equal(toot.hashtags[1], "nyhende");
    assert.ok(toot.hashtags.length >= 3, "and at least the category");
  }
});

test("every posted article has an image for the preview card", () => {
  // Twelve of fourteen carry one; the two without are the daily briefs, which
  // are held anyway — so nothing posts with a bare card.
  for (const evaluation of POSTABLE) {
    assert.ok(evaluation.article.image, `no image on: ${evaluation.article.heading}`);
  }
});

test("nothing on the corpus is walled", () => {
  assert.equal(ARTICLES.filter((a) => a.walled).length, 0);
});

test("the corpus needs a tie-break to have a total order", () => {
  // Four articles share one timestamp and two share another, which is why
  // ordering breaks ties on _id (ADR 0003).
  const times = ARTICLES.map((a) => a.publishedAt);
  assert.ok(new Set(times).size < times.length);
});

test("both written traditions appear, which is what settles language: no", () => {
  const text = ARTICLES.map((a) => `${a.heading} ${a.intro}`).join(" ");
  assert.match(text, /\bikkje\b/, "nynorsk");
  assert.match(text, /\bikke\b/, "bokmål");
  assert.equal(config.language, "no");
});

test("the exact post the plan quotes still composes byte for byte", () => {
  const article = ARTICLES.find((a) => a.slug === "heimekontor-forbod-ein-gavepakke-til-oslo-staten");
  assert.equal(
    composeToot(article, bot.composer).text,
    [
      "– Heimekontor-forbod: Ein gåvepakke til Oslo-staten",
      "",
      "Du får ikkje dei beste folka ved å tvinge dei inn til Oslo-kontoret, skriv Alfred Bjørlo.",
      "",
      "https://www.vestlendingen.no/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten",
      "",
      "#Vestlandet #nyhende #Kommentar",
    ].join("\n"),
  );
});

test("the one tagged article produces the six hashtags from the dry run", () => {
  const article = ARTICLES.find((a) => a.tags.length === 5);
  const { hashtags } = composeToot(article, bot.composer);
  assert.deepEqual(hashtags, [
    "Vestlandet",
    "nyhende",
    "Kommentar",
    "Samferdsel",
    "Haugesund",
    "Stavanger",
  ]);
});

test("posting the noindex articles would give twelve and two", () => {
  // The difference — four posts — is what the noindex decision costs (ADR 0004).
  const permissive = { ...config, noindexPolicy: "post" };
  const posts = ARTICLES.filter(
    (a) => evaluate(a, permissive, { ignoreAge: true, ignoreSeen: true }).post,
  );
  assert.equal(posts.length, 12);
  assert.equal(ARTICLES.length - posts.length, 2);
});
