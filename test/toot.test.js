// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require("node:test");
const assert = require("node:assert/strict");
const { composeToot, weigh, trimToWord, LIMIT, URL_WEIGHT } = require("../lib/toot");
const { makeArticle } = require("../lib/article");

const base = {
  id: "id-1",
  publishedAt: "2026-08-24T21:39:00.000Z",
  heading: "– Heimekontor-forbod: Ein gåvepakke til Oslo-staten",
  intro: "Du får ikkje dei beste folka ved å tvinge dei inn til Oslo-kontoret, skriv Alfred Bjørlo.  ",
  slug: "heimekontor-forbod-ein-gavepakke-til-oslo-staten",
  url: "https://www.vestlendingen.no/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten",
  categories: [{ name: "Kommentar" }],
  tags: [],
  source: "sanity",
};

const opts = { baseHashtags: ["Vestlandet", "nyhende"] };

test("composes heading, intro, link, hashtags in that order", () => {
  const { text } = composeToot(makeArticle(base), opts);
  assert.equal(
    text,
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

test("keeps the paper's leading dash on quote headlines", () => {
  const { text } = composeToot(makeArticle(base), opts);
  assert.ok(text.startsWith("– Heimekontor"), "the dash is the paper's convention, not noise");
});

test("normalises the CMS trailing whitespace on the intro", () => {
  const { text } = composeToot(makeArticle(base), opts);
  assert.ok(!/ {2,}/.test(text), "no runs of spaces");
  assert.ok(!/[ \t]\n/.test(text), "no trailing space at the end of a line");
  assert.ok(!/\n{3,}/.test(text), "no more than one blank line between paragraphs");
});

test("counts a URL as 23 characters, the way Mastodon does", () => {
  const long = `https://example.com/${"x".repeat(400)}`;
  assert.equal(weigh(long, [long]), URL_WEIGHT);
  assert.equal(weigh(`ab ${long}`, [long]), 3 + URL_WEIGHT);
});

test("counts codepoints, not UTF-16 units", () => {
  // The lock emoji is a surrogate pair in JS and one character in Ruby, which is
  // what Mastodon counts with.
  assert.equal(weigh("🔒"), 1);
  assert.equal("🔒".length, 2, "guarding the premise of the test above");
});

test("a walled article gets a lock prefix rather than being skipped", () => {
  const { text } = composeToot(makeArticle({ ...base, walled: true }), opts);
  assert.ok(text.startsWith("🔒 – Heimekontor"));
});

test("stays inside the 500-character budget when the intro is enormous", () => {
  const article = makeArticle({ ...base, intro: "ord ".repeat(400) });
  const toot = composeToot(article, opts);
  assert.ok(toot.truncated);
  assert.ok(toot.chars <= LIMIT, `${toot.chars} > ${LIMIT}`);
});

test("truncation touches the intro only", () => {
  const article = makeArticle({ ...base, intro: "ord ".repeat(400) });
  const { text } = composeToot(article, opts);
  assert.ok(text.startsWith(base.heading), "heading survives whole");
  assert.ok(text.includes(base.url), "link survives whole");
  assert.ok(text.endsWith("#Vestlandet #nyhende #Kommentar"), "hashtags survive whole");
  assert.ok(text.includes("…"));
});

test("truncates at a word boundary", () => {
  const article = makeArticle({
    ...base,
    intro: `${"lange ord her ".repeat(40)}avsluttande`,
  });
  const { text } = composeToot(article, opts);
  const intro = text.split("\n\n")[1];
  assert.ok(intro.endsWith("…"));
  assert.ok(!/\s…$/.test(intro), "no dangling space before the ellipsis");
  assert.ok(!intro.slice(0, -1).endsWith("or"), "should not cut mid-word");
});

test("drops the intro paragraph entirely when nothing useful fits", () => {
  const article = makeArticle({
    ...base,
    heading: "H".repeat(470),
    intro: "ein introduksjon som ikkje får plass",
  });
  const toot = composeToot(article, opts);
  assert.ok(!toot.text.includes("…"), "a lone ellipsis paragraph is worse than none");
  assert.equal(toot.text.split("\n\n").length, 3, "heading, link, hashtags");
});

test("reports over-limit rather than truncating an inviolable heading", () => {
  // The heading is never trimmed, so a heading long enough on its own to blow
  // the budget composes to an unpostable status. composeToot's job is to say so
  // honestly; refusing to post it is the poller's (see poller.test.js).
  const toot = composeToot(makeArticle({ ...base, heading: "H".repeat(470) }), opts);
  assert.ok(toot.chars > LIMIT);
});

test("an article with no intro emits no blank paragraph", () => {
  const { text } = composeToot(makeArticle({ ...base, intro: "" }), opts);
  assert.ok(!text.includes("\n\n\n"));
  assert.equal(text.split("\n\n").length, 3);
});

test("trimToWord refuses budgets too small to say anything", () => {
  assert.equal(trimToWord("hei der", 1), "");
  assert.equal(trimToWord("hei der", 0), "");
});

test("trimToWord returns the text unchanged when it fits", () => {
  assert.equal(trimToWord("hei der", 40), "hei der");
});

test("hard-cuts a single unbroken word rather than trimming to nothing", () => {
  const out = trimToWord("x".repeat(100), 20);
  assert.ok(out.length > 1 && out.endsWith("…"));
});
