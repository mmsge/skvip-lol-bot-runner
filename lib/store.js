// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The per-bot seen store.
 *
 * One JSON file per bot on a mounted volume, holding the ids this bot has
 * already handled plus the outcome of its last cycle (which the status page and
 * the index render). Articles are keyed on the source's stable id — never the
 * slug or the URL — so a slug rewrite upstream cannot make an article look new
 * (ADR 0003).
 *
 * There are two maps, not one, and the difference is the whole point:
 *
 *   seen      handled and finished with — posted, or held for a reason that
 *             will never change (too old, a daily brief, no heading).
 *   deferred  held ONLY because of `robots.noindex`, which is the one policy
 *             still waiting on an answer from the paper's editors. Deferred
 *             articles are not re-fetched and not re-posted, but they are also
 *             not written off: flip NOINDEX_POLICY and they become postable
 *             again. That is what makes "four good articles come back" a
 *             config change rather than an archaeology exercise (ADR 0004).
 */
const fs = require("node:fs/promises");
const path = require("node:path");

const VERSION = 1;
// A bound on the file rather than a retention policy. Nothing is ever pruned in
// practice — the paper has published 14 articles — but an append-only file with
// no ceiling is a slow leak. Pruning is safe because MAX_ARTICLE_AGE_HOURS
// already refuses anything older than a few days: an id old enough to be pruned
// belongs to an article the age filter would reject even if it looked new.
const MAX_SEEN = 10000;
// How many articles the RSS feed remembers. The paper has published 14; fifty
// is a couple of months of output and a few kilobytes of JSON.
const MAX_FEED_ITEMS = 50;

class Store {
  constructor(dir, slug) {
    this.slug = slug;
    this.file = path.join(dir, `${slug}.json`);
    this.seen = new Map(); // id -> ISO first-seen
    this.deferred = new Map(); // id -> ISO first-deferred (noindex holds only)
    this.recent = []; // newest-first feed items (see rememberForFeed)
    this.lastCycle = null;
    this.loaded = false;
  }

  /** Read the file. A missing file is a first run, not an error. */
  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
      for (const [id, at] of Object.entries(raw.seen || {})) this.seen.set(id, at);
      for (const [id, at] of Object.entries(raw.deferred || {})) this.deferred.set(id, at);
      this.recent = Array.isArray(raw.recent) ? raw.recent : [];
      this.lastCycle = raw.lastCycle || null;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    this.loaded = true;
    return this;
  }

  has(key) {
    return this.seen.has(key);
  }

  /**
   * How many ARTICLES a map holds, not how many keys.
   *
   * Each article contributes its id plus a `slug:` alias, so the raw map size
   * roughly doubles the article count — and only roughly, because an article
   * with no slug contributes one key. Counting the non-alias keys is exact.
   */
  static countArticles(map) {
    let n = 0;
    for (const key of map.keys()) if (!key.startsWith("slug:")) n += 1;
    return n;
  }

  get seenArticles() {
    return Store.countArticles(this.seen);
  }

  get deferredArticles() {
    return Store.countArticles(this.deferred);
  }

  /**
   * Every identity an article is known by: its id, plus any alt keys.
   *
   * The fallback recovers the same Sanity `_id` the primary uses, so the id
   * alone is normally enough. The slug alt key is what still holds if that ever
   * stops working — an article posted from one source is then recognised from
   * the other rather than posted twice.
   */
  static keysFor(article) {
    return [article.id, ...(article.altKeys || [])].filter(Boolean);
  }

  hasArticle(article) {
    return Store.keysFor(article).some((key) => this.seen.has(key));
  }

  /**
   * Handled OR deferred — i.e. "this bot has already looked at this".
   *
   * The fallback uses this to decide which article pages it still needs to
   * fetch. A deferred article is one we have already read and decided about, so
   * re-fetching its page every fifteen minutes during an outage would be bad
   * manners for no information.
   */
  isKnownArticle(article) {
    return Store.keysFor(article).some((key) => this.seen.has(key) || this.deferred.has(key));
  }

  isKnownKey(key) {
    return this.seen.has(key) || this.deferred.has(key);
  }

  /** Defer articles held only by the noindex policy. */
  deferArticles(articles, at = new Date().toISOString()) {
    let added = 0;
    for (const article of articles) {
      for (const key of Store.keysFor(article)) {
        if (this.deferred.has(key) || this.seen.has(key)) continue;
        this.deferred.set(key, at);
        added += 1;
      }
    }
    return added;
  }

  /**
   * Mark every identity of each article handled. Call `save()` to persist.
   *
   * A key being promoted out of `deferred` is the normal path for an article
   * that was held on noindex and now posts, so drop it from there.
   */
  markArticles(articles, at = new Date().toISOString()) {
    const keys = articles.flatMap((a) => Store.keysFor(a));
    for (const key of keys) this.deferred.delete(key);
    return this.mark(keys, at);
  }

  get size() {
    return this.seen.size;
  }

  /** Mark ids seen in memory. Call `save()` to persist. */
  mark(ids, at = new Date().toISOString()) {
    let added = 0;
    for (const id of ids) {
      if (this.seen.has(id)) continue;
      this.seen.set(id, at);
      added += 1;
    }
    return added;
  }

  setLastCycle(summary) {
    this.lastCycle = summary;
  }

  /**
   * Keep the newest articles for the RSS feed this house publishes.
   *
   * Merged rather than replaced, because one cycle only ever sees the newest
   * twenty articles and the feed should outlive that window. Capped, newest
   * first, deduplicated on id.
   *
   * What lands here is what passes the content filters — so the feed carries
   * the same articles the robot posts, and omits the ones ADR 0004 says not to
   * mirror. A feed is an index, and indexing what we decided not to index would
   * be the same decision made twice, differently.
   */
  rememberForFeed(items, cap = MAX_FEED_ITEMS) {
    const byId = new Map(this.recent.map((item) => [item.id, item]));
    for (const item of items) byId.set(item.id, item);
    this.recent = [...byId.values()]
      .sort((a, b) => {
        const ta = Date.parse(a.publishedAt || 0) || 0;
        const tb = Date.parse(b.publishedAt || 0) || 0;
        if (ta !== tb) return tb - ta;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      })
      .slice(0, cap);
    return this.recent;
  }

  /**
   * Persist atomically: write a sibling temp file, then rename over the target.
   *
   * A rename within one filesystem is atomic, so a crash mid-write leaves the
   * previous store intact rather than a truncated file that would parse as an
   * empty seen set — which on the next boot would repost the entire corpus.
   */
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });

    let entries = [...this.seen.entries()];
    if (entries.length > MAX_SEEN) {
      entries.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      entries = entries.slice(entries.length - MAX_SEEN);
      this.seen = new Map(entries);
    }

    const body = JSON.stringify(
      {
        version: VERSION,
        slug: this.slug,
        seen: Object.fromEntries(entries),
        deferred: Object.fromEntries(this.deferred),
        recent: this.recent,
        lastCycle: this.lastCycle,
      },
      null,
      2,
    );
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, `${body}\n`, "utf8");
    await fs.rename(tmp, this.file);
  }
}

module.exports = { Store, MAX_SEEN, MAX_FEED_ITEMS };
