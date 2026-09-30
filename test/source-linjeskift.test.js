// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The linjeskift source, against a real SQLite file built with node:sqlite and
 * the DDL linjeskift itself ships (`store.py` SCHEMA, WAL mode). No mocks: the
 * query is the thing under test.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const source = require("../lib/source-linjeskift");
const descriptor = require("../bots/linjeskift");
const { botConfig } = require("../lib/config");

// Relevant part of linjeskift's schema, verbatim. The FTS table and its
// triggers are left out: the runner never touches them.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS digests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  item_count   INTEGER NOT NULL,
  page_path    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  published_at  TEXT,
  raw_summary   TEXT,
  fetched_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new',
  tier          TEXT,
  category      TEXT,
  country       TEXT,
  relevance     REAL,
  reason        TEXT,
  headline      TEXT,
  summary       TEXT,
  classified_at TEXT,
  pushed_breaking_at TEXT,
  digest_id     INTEGER,
  FOREIGN KEY (digest_id) REFERENCES digests(id)
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
`;

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mastobots-linjeskift-"));
}

const ROWS = [
  // id, tier, category, country, relevance, published_at, status
  ["a-digest-high", "digest", "new_line", "DE", 0.8, "2026-09-29T10:00:00Z", "classified"],
  ["b-digest-low", "digest", "infrastructure", "FR", 0.1, "2026-09-29T11:00:00Z", "classified"],
  ["c-digest-edge", "digest", "night_train", "AT", 0.3, "2026-09-29T09:00:00Z", "classified"],
  ["d-breaking-old", "breaking", "network_change", "Nordic", 0.9, "2026-09-27T08:00:00Z", "classified"],
  ["e-drop", "drop", "new_line", "DE", 0.9, "2026-09-29T12:00:00Z", "classified"],
  ["f-new", null, null, null, null, "2026-09-29T12:30:00Z", "new"],
  ["g-error", "digest", "new_line", "DE", 0.9, "2026-09-29T12:40:00Z", "error"],
  ["h-nodate", "digest", "major_disruption", "other", 0.7, null, "classified"],
  ["i-breaking-low", "breaking", "new_line", "GB", 0.05, "2026-09-28T08:00:00Z", "classified"],
];

// linjeskift 1.1.0 added `lang` to the end of items; linjeskift runs the ALTER
// TABLE on an old database, which appends the column the same way.
const SCHEMA_WITH_LANG = SCHEMA.replace(
  "  digest_id     INTEGER,\n",
  "  digest_id     INTEGER,\n  lang          TEXT,\n",
);

function buildDb(rows = ROWS, { schema = SCHEMA, langs = {} } = {}) {
  const file = path.join(tmpdir(), "linjeskift.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(schema);
  const insert = db.prepare(
    `INSERT INTO items (id, source, url, title, published_at, raw_summary, fetched_at,
                        status, tier, category, country, relevance)
     VALUES (?, 'railway_gazette', ?, ?, ?, ?, '2026-09-29T13:00:00Z', ?, ?, ?, ?, ?)`,
  );
  for (const [id, tier, category, country, relevance, published, status] of rows) {
    insert.run(id, `https://example.test/${id}`, `Title ${id}`, published, `Snippet ${id}`, status, tier, category, country, relevance);
  }
  if (schema === SCHEMA_WITH_LANG) {
    const setLang = db.prepare("UPDATE items SET lang = ? WHERE id = ?");
    for (const [id, lang] of Object.entries(langs)) setLang.run(lang, id);
  }
  db.close();
  return file;
}

function configFor(file, env = {}) {
  return botConfig(descriptor, { LINJESKIFT_DB_PATH: file, ...env });
}

const read = (file, env, limit = 50) =>
  source.fetchArticles(configFor(file, env), { limit, labels: descriptor.labels });

test("returns classified breaking items and digest items above the relevance floor", () => {
  const ids = read(buildDb()).map((a) => a.id);
  assert.deepEqual(ids.sort(), [
    "a-digest-high",
    "c-digest-edge",
    "d-breaking-old",
    "h-nodate",
    "i-breaking-low",
  ]);
});

test("the floor is inclusive, configurable, and does not apply to breaking items", () => {
  const strict = read(buildDb(), { LINJESKIFT_RELEVANCE_MIN: "0.75" }).map((a) => a.id).sort();
  assert.deepEqual(strict, ["a-digest-high", "d-breaking-old", "i-breaking-low"]);
});

test("orders newest first, whatever the tier", () => {
  const ids = read(buildDb()).map((a) => a.id);
  assert.deepEqual(ids, [
    "h-nodate", // no date: fetched_at (13:00) stands in, so it is the newest
    "a-digest-high",
    "c-digest-edge",
    "i-breaking-low",
    "d-breaking-old",
  ]);
});

test("maps a row onto the shared article shape", () => {
  const article = read(buildDb()).find((a) => a.id === "a-digest-high");
  assert.equal(article.heading, "Title a-digest-high");
  assert.equal(article.intro, "Snippet a-digest-high");
  assert.equal(article.url, "https://example.test/a-digest-high");
  assert.equal(article.publishedAt, "2026-09-29T10:00:00Z");
  assert.equal(article.breaking, false);
  assert.equal(article.noindex, false);
  assert.equal(article.walled, false);
  assert.deepEqual(article.categories.map((c) => c.name), ["Nytt samband", "Tyskland"]);
  assert.deepEqual(article.tags, []);
});

test("falls back to fetched_at without a publication date, and flags breaking", () => {
  const articles = read(buildDb());
  assert.equal(articles.find((a) => a.id === "h-nodate").publishedAt, "2026-09-29T13:00:00Z");
  assert.equal(articles.find((a) => a.id === "d-breaking-old").breaking, true);
});

test("the bucket country 'other' makes no label, and an unknown code falls back", () => {
  const { labelFor } = source;
  assert.equal(labelFor(descriptor.labels.country, "other"), null);
  assert.equal(labelFor(descriptor.labels.country, "de"), "Tyskland");
  assert.equal(labelFor(descriptor.labels.country, "XX"), "XX");
  assert.equal(labelFor(descriptor.labels.category, "brand_new"), "brand new");
  assert.equal(labelFor(descriptor.labels.category, null), null);
  const article = read(buildDb()).find((a) => a.id === "h-nodate");
  assert.deepEqual(article.categories.map((c) => c.name), ["Større avbrot"]);
});

test("LIMIT keeps the newest items, so old breaking items cannot crowd out new ones", () => {
  // Tiers never change, so a breaking-first window would fill up with
  // long-posted breaking items and never reach a new digest item again.
  const ids = read(buildDb(), {}, 2).map((a) => a.id);
  assert.deepEqual(ids, ["h-nodate", "a-digest-high"]);
});

test("opens the database read-only, and reads while a writer holds it in WAL mode", () => {
  const file = buildDb();
  const writer = new DatabaseSync(file);
  writer.exec("PRAGMA journal_mode=WAL");
  writer.exec("BEGIN");
  writer.exec("UPDATE items SET title = 'Changed' WHERE id = 'a-digest-high'");
  try {
    const article = read(file).find((a) => a.id === "a-digest-high");
    assert.equal(article.heading, "Title a-digest-high", "the uncommitted write is not visible");
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
  }
  // And what the runner opens really is read-only.
  const probe = new DatabaseSync(file, { readOnly: true });
  assert.throws(() => probe.exec("DELETE FROM items"), /readonly/i);
  probe.close();
});

test("a missing database is a source failure that names nothing", () => {
  const missing = path.join(tmpdir(), "nope.db");
  assert.throws(
    () => read(missing),
    (err) => /linjeskift database unavailable/.test(err.message) && !err.message.includes(missing),
  );
});

test("a file that is not a database, or lacks the table, is a source failure", () => {
  const junk = path.join(tmpdir(), "junk.db");
  fs.writeFileSync(junk, "this is not sqlite");
  assert.throws(() => read(junk), /linjeskift database unavailable/);

  const empty = path.join(tmpdir(), "empty.db");
  new DatabaseSync(empty).close();
  assert.throws(() => read(empty), /linjeskift database unavailable/);
});

test("an empty items table is an empty result, not a failure", () => {
  assert.deepEqual(read(buildDb([])), []);
});

test("reads the item's language when the database has the lang column", () => {
  const file = buildDb(ROWS, {
    schema: SCHEMA_WITH_LANG,
    langs: { "a-digest-high": "nl", "c-digest-edge": "NO", "h-nodate": "not a code" },
  });
  const byId = Object.fromEntries(read(file).map((a) => [a.id, a.language]));
  assert.equal(byId["a-digest-high"], "nl");
  assert.equal(byId["c-digest-edge"], "no", "a code is lowercased");
  assert.equal(byId["h-nodate"], null, "something that is not a language code is no language");
  assert.equal(byId["d-breaking-old"], null, "NULL in the column stays null");
});

test("a database without the lang column still reads, with no language on any item", () => {
  const file = buildDb(); // the pre-1.1.0 schema
  assert.equal(source.hasLangColumn(new DatabaseSync(file, { readOnly: true })), false);
  const articles = read(file);
  assert.equal(articles.length, 5);
  assert.deepEqual([...new Set(articles.map((a) => a.language))], [null]);
});

test("hasLangColumn sees the column on a current database", () => {
  const db = new DatabaseSync(buildDb(ROWS, { schema: SCHEMA_WITH_LANG }), { readOnly: true });
  assert.equal(source.hasLangColumn(db), true);
  db.close();
});
