// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, MAX_FEED_ITEMS } = require("../lib/store");
const { makeArticle } = require("../lib/article");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mastobots-store-"));
}

const article = (id, slug = `slug-${id}`) =>
  makeArticle({
    id,
    slug,
    url: `https://example.com/artikler/${slug}`,
    heading: `Sak ${id}`,
    intro: "Ingress.",
    publishedAt: "2026-08-24T21:39:00.000Z",
    source: "sanity",
  });

test("a missing file is a first run, not an error", async () => {
  const store = await new Store(path.join(tmpdir(), "nested"), "bot").load();
  assert.equal(store.size, 0);
  assert.equal(store.lastCycle, null);
});

test("round-trips seen, deferred, recent and lastCycle", async () => {
  const dir = tmpdir();
  const a = await new Store(dir, "bot").load();
  a.markArticles([article("1")]);
  a.deferArticles([article("2")]);
  a.rememberForFeed([{ id: "1", title: "Sak 1", publishedAt: "2026-08-24T21:39:00.000Z" }]);
  a.setLastCycle({ at: "2026-08-25T10:00:00.000Z", source: "sanity", posted: 1 });
  await a.save();

  const b = await new Store(dir, "bot").load();
  assert.ok(b.hasArticle(article("1")));
  assert.ok(!b.hasArticle(article("2")), "deferred is not seen");
  assert.ok(b.isKnownArticle(article("2")), "but it is known");
  assert.equal(b.recent.length, 1);
  assert.equal(b.lastCycle.source, "sanity");
});

test("recognises an article by its slug alias when the id differs", () => {
  // The safety net for the fallback: if id recovery from the article page ever
  // stops working, the slug key still prevents a repost (ADR 0002).
  const store = new Store(tmpdir(), "bot");
  store.markArticles([article("uuid-1", "same-slug")]);
  assert.ok(store.hasArticle(article("slug:same-slug", "same-slug")));
});

test("counts articles rather than keys", () => {
  const store = new Store(tmpdir(), "bot");
  store.markArticles([article("1"), article("2")]);
  assert.equal(store.seen.size, 4, "two keys per article");
  assert.equal(store.seenArticles, 2);
});

test("marking an article promotes it out of deferred", () => {
  const store = new Store(tmpdir(), "bot");
  store.deferArticles([article("1")]);
  assert.equal(store.deferredArticles, 1);
  store.markArticles([article("1")]);
  assert.equal(store.deferredArticles, 0);
  assert.equal(store.seenArticles, 1);
});

test("deferring an already-seen article is a no-op", () => {
  const store = new Store(tmpdir(), "bot");
  store.markArticles([article("1")]);
  store.deferArticles([article("1")]);
  assert.equal(store.deferredArticles, 0);
});

test("the feed merges across cycles rather than being replaced", () => {
  const store = new Store(tmpdir(), "bot");
  store.rememberForFeed([{ id: "old", publishedAt: "2026-08-01T00:00:00.000Z" }]);
  store.rememberForFeed([{ id: "new", publishedAt: "2026-08-24T00:00:00.000Z" }]);
  assert.deepEqual(
    store.recent.map((i) => i.id),
    ["new", "old"],
    "newest first, and the older cycle's item survives",
  );
});

test("the feed deduplicates on id and keeps the newer copy", () => {
  const store = new Store(tmpdir(), "bot");
  store.rememberForFeed([{ id: "a", title: "gammal", publishedAt: "2026-08-01T00:00:00.000Z" }]);
  store.rememberForFeed([{ id: "a", title: "retta", publishedAt: "2026-08-01T00:00:00.000Z" }]);
  assert.equal(store.recent.length, 1);
  assert.equal(store.recent[0].title, "retta");
});

test("the feed is capped", () => {
  const store = new Store(tmpdir(), "bot");
  store.rememberForFeed(
    Array.from({ length: MAX_FEED_ITEMS + 20 }, (_, i) => ({
      id: `a${i}`,
      publishedAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(),
    })),
  );
  assert.equal(store.recent.length, MAX_FEED_ITEMS);
});

test("the feed breaks ties on id so ordering is total", () => {
  const store = new Store(tmpdir(), "bot");
  const at = "2026-08-19T20:00:00.000Z";
  store.rememberForFeed([
    { id: "aaa", publishedAt: at },
    { id: "zzz", publishedAt: at },
  ]);
  assert.deepEqual(
    store.recent.map((i) => i.id),
    ["zzz", "aaa"],
  );
});

test("save leaves no temp file behind", async () => {
  const dir = tmpdir();
  const store = await new Store(dir, "bot").load();
  store.markArticles([article("1")]);
  await store.save();
  assert.deepEqual(fs.readdirSync(dir), ["bot.json"]);
});

test("a truncated store file is a load error, not a silently empty seen set", async () => {
  // The failure mode this guards: parsing a half-written file as an empty store
  // would repost the whole corpus on the next cycle.
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "bot.json"), '{"version":1,"seen":{"a"');
  await assert.rejects(() => new Store(dir, "bot").load());
});
