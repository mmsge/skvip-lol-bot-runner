// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The linjeskift source: a sibling service's SQLite database (ADR 0010).
 *
 * linjeskift ingests European rail news, decides what is worth keeping and
 * writes the verdict into an `items` table. This robot only reads that table
 * and toots what it finds: the original English title, the feed snippet, the
 * link. Nothing is generated on this side either.
 *
 * The database is opened `readOnly` afresh every cycle and closed in a
 * `finally`, so no handle outlives a cycle and a database that is replaced or
 * restored underneath us is picked up on the next one. The mount is read-write
 * even so, because a reader of a WAL database must be able to create and write
 * the `-shm` and `-wal` files beside it.
 *
 * A missing or locked database is a source failure, not an empty result: the
 * error thrown here carries only SQLite's generic message, never a row, and the
 * poller posts nothing and retries next cycle.
 */
const { DatabaseSync } = require("node:sqlite");
const { makeArticle, byNewest } = require("./article");

const SOURCE = "linjeskift-db";

// The newest items, whatever their tier. Only items linjeskift has finished
// with (`classified`) are candidates, and a digest item must clear the
// relevance floor. The floor is a runner setting so it can be retuned without
// touching linjeskift.
//
// Breaking does NOT sort first here. A tier never changes once written, so a
// breaking-first ORDER BY would let the database's growing pile of old,
// long-posted breaking items fill every LIMIT slot and starve new digest items
// for good. The window is the newest `limit` items; the poller moves breaking
// items to the front of that window before the per-cycle cap.
const QUERY = `
SELECT id, source, url, title, published_at, raw_summary, fetched_at,
       tier, category, country, relevance
FROM items
WHERE status = 'classified'
  AND (tier = 'breaking' OR (tier = 'digest' AND relevance >= :min))
ORDER BY COALESCE(published_at, fetched_at) DESC,
         id DESC
LIMIT :limit`;

/** Label for a code, or null when there is nothing worth tagging. */
function labelFor(map, code) {
  if (!code) return null;
  if (map[code]) return map[code];
  if (map[String(code).toUpperCase()]) return map[String(code).toUpperCase()];
  // Country 'other' is a bucket, not a place; a hashtag for it would say nothing.
  if (code === "other") return null;
  return String(code).replace(/_/g, " ");
}

/** Map one row onto the shared Article shape. */
function toArticle(row, labels) {
  const names = [labelFor(labels.category, row.category), labelFor(labels.country, row.country)];
  return makeArticle({
    id: row.id,
    publishedAt: row.published_at || row.fetched_at,
    heading: row.title,
    intro: row.raw_summary,
    url: row.url,
    breaking: row.tier === "breaking",
    categories: names.filter(Boolean).map((name) => ({ name })),
    source: SOURCE,
  });
}

/**
 * Read the items worth posting.
 *
 * Throws on a database that cannot be opened or read. The message is SQLite's
 * generic error string, which names no item.
 */
function fetchArticles(config, { limit = 50, labels = { category: {}, country: {} } } = {}) {
  let db;
  try {
    db = new DatabaseSync(config.dbPath, { readOnly: true, timeout: 5000 });
    const rows = db.prepare(QUERY).all({ min: config.relevanceMin, limit });
    return rows.map((row) => toArticle(row, labels)).sort(byNewest);
  } catch (err) {
    const reason = err && (err.errstr || err.code) ? String(err.errstr || err.code) : "unreadable";
    throw new Error(`linjeskift database unavailable: ${reason}`);
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Already closed, or never opened. Nothing to add to the failure.
      }
    }
  }
}

module.exports = { fetchArticles, toArticle, labelFor, QUERY, SOURCE };
