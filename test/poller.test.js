// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Cycle tests. Everything upstream is stubbed: no network, no clock.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runCycle, isDeferrable } = require("../lib/poller");
const { Store } = require("../lib/store");
const { prepare } = require("../lib/registry");
const sanity = require("../lib/source-sanity");
const sitemap = require("../lib/source-sitemap");
const descriptor = require("../bots/vestlendingen");

const CORPUS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "sanity-corpus.json"), "utf8"),
).result;
// Just after the newest article in the corpus, so nothing is too old.
const NOW = Date.parse("2026-08-25T10:00:00.000Z");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mastobots-poller-"));
}

// Most of the corpus predates NOW by more than the 72-hour window, so tests that
// want the whole thing in play widen it. That is not a workaround: the age filter
// is doing exactly its job, and a live first run marks these seen anyway.
const WIDE_AGE = { MAX_ARTICLE_AGE_HOURS: "8760" };

function setup(env = {}) {
  const { bot, config } = prepare(descriptor, {
    VESTLENDINGEN_MASTODON_TOKEN: "tok",
    DATA_DIR: tmpdir(),
    POST_SPACING_SECONDS: "0",
    ...env,
  });
  return { bot, config, store: new Store(tmpdir(), bot.slug) };
}

function stubSanity(t, docs = CORPUS) {
  t.mock.method(sanity, "fetchArticles", async (config) =>
    docs.map((d) => sanity.toArticle(d, config.sourceOrigin)).sort((a, b) =>
      a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : a.id < b.id ? 1 : -1,
    ),
  );
}

function recordingClient() {
  const posts = [];
  return {
    posts,
    async postStatus(payload) {
      posts.push(payload);
      return { id: String(posts.length), url: `https://skvip.lol/@bot/${posts.length}` };
    },
  };
}

const deps = (client) => ({ now: NOW, sleep: async () => {}, client });

test("the first run marks the corpus and posts nothing", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup();
  const client = recordingClient();

  const summary = await runCycle(bot, config, store, deps(client));

  assert.equal(client.posts.length, 0, "the account starts quiet");
  assert.equal(summary.posted, 0);
  assert.equal(store.seenArticles, 10);
  assert.equal(store.deferredArticles, 4, "the noindex-only articles stay actionable");
});

test("BACKFILL=1 posts the corpus instead of marking it", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup({ ...WIDE_AGE, BACKFILL: "1", MAX_POSTS_PER_CYCLE: "20" });
  const client = recordingClient();

  await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 8, "the eight the decisions allow");
});

test("a second cycle posts only what is new", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup();
  const client = recordingClient();
  await runCycle(bot, config, store, deps(client));

  const fresh = {
    ...CORPUS[0],
    _id: "99999999-9999-4999-8999-999999999999",
    slug: "ei-fersk-sak",
    heading: "Ei fersk sak",
    intro: "Med ein ingress.",
    robots: { noindex: false },
    noindex: false,
  };
  t.mock.restoreAll();
  stubSanity(t, [fresh, ...CORPUS]);

  await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 1);
  assert.match(client.posts[0].status, /^Ei fersk sak\n\n/);
  assert.equal(client.posts[0].language, "no");
  assert.equal(client.posts[0].visibility, "public");
});

test("posts oldest first so the timeline reads in publication order", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup({ ...WIDE_AGE, BACKFILL: "1", MAX_POSTS_PER_CYCLE: "20" });
  const client = recordingClient();
  await runCycle(bot, config, store, deps(client));

  const order = client.posts.map((p) => p.status.split("\n")[0]);
  assert.equal(order[0], "Forholdet mellom næringslivet og kulturlivet er i krise", "the June article");
  assert.equal(order.at(-1), "– Formuesskatteopprøret på Vestlandet må stå opp for Ine");
});

test("MAX_POSTS_PER_CYCLE caps a bulk publish without losing the rest", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup({ ...WIDE_AGE, BACKFILL: "1", MAX_POSTS_PER_CYCLE: "3" });
  const client = recordingClient();

  await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 3);
  await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 6, "the backlog drains rather than starving");
});

test("a failed post leaves the article unseen and is retried next cycle", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup({ BACKFILL: "1", MAX_POSTS_PER_CYCLE: "1" });
  let attempts = 0;
  const client = {
    async postStatus(payload) {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error("boom");
        err.retryable = false;
        throw err;
      }
      return { id: "1", url: "u", payload };
    },
  };

  const first = await runCycle(bot, config, store, deps(client));
  assert.equal(first.posted, 0);
  assert.equal(first.failed, 1);

  const second = await runCycle(bot, config, store, deps(client));
  assert.equal(second.posted, 1, "the same article came back");
});

test("every status carries an idempotency key derived from the article", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup({ ...WIDE_AGE, BACKFILL: "1", MAX_POSTS_PER_CYCLE: "20" });
  const client = recordingClient();
  await runCycle(bot, config, store, deps(client));

  const keys = client.posts.map((p) => p.idempotencyKey);
  assert.equal(keys.filter(Boolean).length, keys.length);
  assert.equal(new Set(keys).size, keys.length, "one key per article");
});

test("falls back to the sitemap when Sanity is unavailable", async (t) => {
  t.mock.method(sanity, "fetchArticles", async () => {
    throw new Error("403 from the dataset");
  });
  const fallbackArticle = sitemap.parseArticlePage(
    fs.readFileSync(path.join(__dirname, "fixtures", "article-open.html"), "utf8"),
    { url: "https://www.vestlendingen.no/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten" },
  );
  t.mock.method(sitemap, "fetchArticles", async () => [fallbackArticle]);

  const { bot, config, store } = setup({ BACKFILL: "1" });
  const client = recordingClient();
  const summary = await runCycle(bot, config, store, deps(client));

  assert.equal(summary.source, "sitemap");
  assert.equal(client.posts.length, 1);
});

test("an article posted via Sanity is not reposted via the fallback", async (t) => {
  // The fallback recovers the same _id, so the seen store recognises it.
  stubSanity(t, [CORPUS.find((d) => d.slug === "heimekontor-forbod-ein-gavepakke-til-oslo-staten")]);
  const { bot, config, store } = setup({ BACKFILL: "1" });
  const client = recordingClient();
  await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 1);

  t.mock.restoreAll();
  t.mock.method(sanity, "fetchArticles", async () => {
    throw new Error("dataset closed");
  });
  const viaFallback = sitemap.parseArticlePage(
    fs.readFileSync(path.join(__dirname, "fixtures", "article-open.html"), "utf8"),
    { url: "https://www.vestlendingen.no/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten" },
  );
  t.mock.method(sitemap, "fetchArticles", async () => [viaFallback]);

  await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 1, "still one");
});

test("both sources failing posts nothing and records the outage", async (t) => {
  t.mock.method(sanity, "fetchArticles", async () => {
    throw new Error("dataset gone");
  });
  t.mock.method(sitemap, "fetchArticles", async () => {
    throw new Error("sitemap gone");
  });
  const { bot, config, store } = setup();
  const client = recordingClient();

  const summary = await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 0);
  assert.equal(summary.source, null);
  assert.match(summary.error, /both sources/);
  assert.equal(store.seenArticles, 0, "nothing was read, so nothing is written off");
});

test("DRY_RUN composes but never calls Mastodon", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup({ ...WIDE_AGE, BACKFILL: "1", DRY_RUN: "1", MAX_POSTS_PER_CYCLE: "20" });
  const client = {
    async postStatus() {
      throw new Error("a dry run must not post");
    },
  };
  const summary = await runCycle(bot, config, store, deps(client));
  assert.equal(summary.posted, 8);
  assert.equal(summary.dryRun, true);
});

test("the feed fills on the first run, before anything has posted", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup();
  await runCycle(bot, config, store, deps(recordingClient()));
  assert.equal(store.recent.length, 8, "otherwise the feed would take months to become useful");
});

test("the feed omits the articles the noindex policy holds back", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup();
  await runCycle(bot, config, store, deps(recordingClient()));
  const headings = store.recent.map((i) => i.title);
  assert.ok(!headings.includes("Velkommen til Vestlendingen"));
  assert.ok(!headings.includes("Torsdag 20. august"));
});

test("an oversized status is written off rather than retried forever", async (t) => {
  const huge = { ...CORPUS[0], _id: "huge", slug: "huge", heading: "H".repeat(600) };
  stubSanity(t, [huge]);
  const { bot, config, store } = setup({ BACKFILL: "1" });
  const client = recordingClient();

  const first = await runCycle(bot, config, store, deps(client));
  assert.equal(client.posts.length, 0);
  assert.equal(first.oversized, 1);

  const second = await runCycle(bot, config, store, deps(client));
  assert.equal(second.oversized, 0, "it does not come back");
});

test("flipping NOINDEX_POLICY brings the deferred articles back", async (t) => {
  // The reason the policy stayed a config value rather than being compiled
  // away: the editors' answer is actionable the hour it arrives (ADR 0004).
  stubSanity(t);
  const { bot, config, store } = setup();
  await runCycle(bot, config, store, deps(recordingClient()));
  assert.equal(store.deferredArticles, 4);

  const flipped = setup({
    VESTLENDINGEN_NOINDEX_POLICY: "post",
    MAX_ARTICLE_AGE_HOURS: "8760",
    MAX_POSTS_PER_CYCLE: "20",
  });
  const client = recordingClient();
  await runCycle(flipped.bot, flipped.config, store, deps(client));

  assert.equal(client.posts.length, 4);
  assert.equal(store.deferredArticles, 0);
});

test("a noindex article that is also a daily brief is written off, not deferred", () => {
  assert.equal(isDeferrable({ reasons: ["noindex"] }), true);
  assert.equal(isDeferrable({ reasons: ["noindex", "too-old"] }), true, "ageing out must not write it off");
  assert.equal(isDeferrable({ reasons: ["noindex", "daily-brief"] }), false);
  assert.equal(isDeferrable({ reasons: ["too-old"] }), false);
});

test("noindex policy unlisted posts the held articles quietly", async (t) => {
  stubSanity(t);
  const { bot, config, store } = setup({
    ...WIDE_AGE,
    VESTLENDINGEN_NOINDEX_POLICY: "unlisted",
    BACKFILL: "1",
    MAX_POSTS_PER_CYCLE: "20",
  });
  const client = recordingClient();
  await runCycle(bot, config, store, deps(client));

  const unlisted = client.posts.filter((p) => p.visibility === "unlisted");
  assert.equal(client.posts.length, 12, "eight, plus the four noindex ones");
  assert.equal(unlisted.length, 4);
});
