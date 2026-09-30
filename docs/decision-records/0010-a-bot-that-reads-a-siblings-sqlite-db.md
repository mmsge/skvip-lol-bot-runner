# 0010 — A bot that reads a sibling's SQLite DB

**Status:** Accepted
**Contributors:** Markus (asked & decided: the runner does the posting, reading linjeskift's SQLite DB bind-mounted read-write and opened read-only, Node 24 for `node:sqlite`) + Claude (proposed/implemented)
**Topics:** architecture, sqlite, docker, permissions, box-conventions

## Context

`@linjeskift@skvip.lol` posts European rail news. Another service, linjeskift,
ingests the feeds and decides what is worth keeping, and stores its verdicts in
a SQLite database (WAL mode). The runner is a house of robots that until now
read websites over HTTP (ADR 0007). Three alternatives to reading the database
directly were on the table:

- **linjeskift calls the Mastodon API itself.** That splits posting across two
  services and puts a second Mastodon token and a second seen-store on the box.
- **linjeskift exposes an HTTP endpoint.** More surface on a box that is short
  on memory, for data that already sits in a file on the same host.
- **A queue or a file drop.** Another moving part, and a place where an item
  can be lost between the two.

## Decision

**The runner reads linjeskift's database directly, as a bot whose `source` is
`linjeskift-db`.**

- Selection is linjeskift's verdict plus a runner-side floor: `status =
  'classified'` and either `tier = 'breaking'` or `tier = 'digest'` with
  `relevance >= LINJESKIFT_RELEVANCE_MIN` (0.30). The floor lives here so it can
  be retuned without touching linjeskift.
- The DB is opened with `new DatabaseSync(path, { readOnly: true })` **every
  cycle** and closed in a `finally`. No handle outlives a cycle, so a restored
  or replaced database is picked up next time.
- **The bind mount is read-write even though the connection is read-only.** A
  reader of a WAL database has to create and write the `-shm` file, and to
  create `-wal` if it is absent. A `:ro` mount makes every open fail. The
  `readOnly` option is what stops the runner writing rows.
- The data directory belongs to a host group. The container joins it with
  `group_add: ["${LINJESKIFT_GID:-10001}"]`, and the host directory is
  `chgrp`ed and `chmod g+rwX` once. No world-writable directory, no root.
- **Missing or locked DB is a source failure.** The cycle posts nothing, writes
  nothing off, logs an event that carries only SQLite's generic error text, and
  tries again next cycle. There is no fallback path: unlike Sanity, this source
  has no second one.
- **Breaking items jump the cap.** After filtering, the poller sorts with a
  stable sort, breaking first, and only then slices to `MAX_POSTS_PER_CYCLE`.
  Vestlendingen has no breaking items and sorts exactly as before. The SQL
  itself reads the newest `fetchLimit` items with no tier priority: a tier
  never changes, so a breaking-first window would fill with old, long-posted
  breaking items and starve new digest items for good.
- **Node 24**, for `node:sqlite` without a flag, so the runner keeps its zero
  runtime dependencies. On Node 22 it works but prints an ExperimentalWarning.
- The toot is not generated: the original English title, the feed snippet, the
  link, and hashtags made from a base tag plus the Nynorsk category and country
  labels, which are copied into the descriptor from linjeskift.

## Consequences

- The two services are coupled through the schema of the `items` table. The
  columns the runner reads are `id, source, url, title, published_at,
  raw_summary, fetched_at, status, tier, category, country, relevance`. A
  rename in linjeskift breaks the robot, and `test/source-linjeskift.test.js`
  builds a fixture from linjeskift's DDL so the break shows up in tests.
- The category and country label maps exist in two places and can drift. An
  unknown code falls back to a readable hashtag rather than failing.
- The `linjeskift` process and the runner share a directory and a group. If the
  GID is wrong the robot logs `source.unavailable` every cycle and posts
  nothing, which is loud but not obvious. Check the group first.
- The house now refuses to boot without `LINJESKIFT_MASTODON_TOKEN`, unless
  `DRY_RUN=1`, as for every other robot.
- The runner never writes to the database, so deleting or reclassifying items in
  linjeskift never needs coordination. An item already posted is remembered in
  the runner's own store, keyed on the item id.
- Logging rules are unchanged: counts and durations only, never a title or URL.
