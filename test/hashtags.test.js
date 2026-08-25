// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require("node:test");
const assert = require("node:assert/strict");
const { toHashtag, buildHashtags, renderHashtags } = require("../lib/hashtags");

test("CamelCases a multi-word publisher label", () => {
  assert.equal(toHashtag("Sjømat og havbruk"), "SjømatOgHavbruk");
});

test("keeps Norwegian letters rather than transliterating them", () => {
  // The whole reason there is no transliteration table (ADR 0006).
  assert.equal(toHashtag("Ålesund"), "Ålesund");
  assert.equal(toHashtag("Nærøyfjorden"), "Nærøyfjorden");
});

test("splits on punctuation Mastodon would not accept in a tag", () => {
  assert.equal(toHashtag("Heimekontor-forbod"), "HeimekontorForbod");
  assert.equal(toHashtag("E39/E16"), "E39E16");
});

test("preserves an intentional inner capital", () => {
  assert.equal(toHashtag("NRK Vestland"), "NRKVestland");
});

test("refuses labels Mastodon would reject", () => {
  assert.equal(toHashtag("2026"), null, "all-digit tags are invalid on Mastodon");
  assert.equal(toHashtag("   "), null);
  assert.equal(toHashtag("!!!"), null);
  assert.equal(toHashtag(""), null);
  assert.equal(toHashtag(null), null);
});

test("base hashtags are used verbatim, not CamelCased", () => {
  // This is what keeps #nyhende lower case while every derived tag is capitalised.
  const tags = buildHashtags({}, { base: ["Vestlandet", "nyhende"] });
  assert.deepEqual(tags, ["Vestlandet", "nyhende"]);
});

test("reproduces the tagged article from the dry run", () => {
  const tags = buildHashtags(
    {
      categories: [{ name: "Kommentar" }],
      tags: [
        { name: "Samferdsel" },
        { name: "Haugesund" },
        { name: "Stavanger" },
        { name: "Bergen" },
        { name: "Bompenger" },
      ],
    },
    { base: ["Vestlandet", "nyhende"] },
  );
  assert.equal(
    renderHashtags(tags),
    "#Vestlandet #nyhende #Kommentar #Samferdsel #Haugesund #Stavanger",
    "the three-tag cap drops Bergen and Bompenger, and the category is not counted against it",
  );
});

test("the category survives a tag-heavy article", () => {
  // Capping categories and tags together would let five tags push the article's
  // own section off the post.
  const tags = buildHashtags(
    {
      categories: [{ name: "Kommentar" }],
      tags: Array.from({ length: 9 }, (_, i) => ({ name: `Tag${i}` })),
    },
    { base: [] },
  );
  assert.equal(tags[0], "Kommentar");
  assert.equal(tags.length, 4, "category + three tags");
});

test("drops a label the publisher marked noindex", () => {
  const tags = buildHashtags(
    {
      categories: [{ name: "Debatt" }],
      tags: [{ name: "Hemmeleg", noindex: true }, { name: "Opa" }],
    },
    { base: [] },
  );
  assert.deepEqual(tags, ["Debatt", "Opa"]);
});

test("a dropped noindex tag does not consume a slot in the cap", () => {
  const tags = buildHashtags(
    {
      tags: [
        { name: "EinA", noindex: true },
        { name: "EinB" },
        { name: "EinC" },
        { name: "EinD" },
      ],
    },
    { base: [], maxTags: 3 },
  );
  assert.deepEqual(tags, ["EinB", "EinC", "EinD"]);
});

test("deduplicates case-insensitively, as Mastodon does", () => {
  const tags = buildHashtags(
    { categories: [{ name: "Kommentar" }], tags: [{ name: "kommentar" }] },
    { base: ["Kommentar"] },
  );
  assert.deepEqual(tags, ["Kommentar"]);
});

test("strips a leading # from a configured base hashtag", () => {
  assert.deepEqual(buildHashtags({}, { base: ["#Vestlandet"] }), ["Vestlandet"]);
});
