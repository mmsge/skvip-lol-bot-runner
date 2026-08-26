# mastobots

A house for Mastodon robots. Each robot reads a source and posts new articles to
a Mastodon account on skvip.lol. One lives here today:
**`@botlendingen@skvip.lol`**, which posts new articles from
vestlendingen.no.

Repo `mmsge/skvip-lol-bot-runner`; the **slug is `mastobots`** (ADR 0007).

<!-- Deployment & box context — KEEP this block. It is what a single-repo agent
     needs to work on this service safely without seeing the rest of the box. -->

## Deployment (Hetzner box)

| Key | Value |
|-----|-------|
| Slug / dir | `mastobots` → `/srv/mastobots` |
| Domain | `mastobots.skvip.lol` |
| Host port | `4010` (bound `172.18.0.1:4010`) |
| Runtime | Docker Compose |
| Deploy | `cd /srv/mastobots && make deploy` |

**Central ingress — do NOT manage TLS/routing here.** Caddy (TLS + reverse proxy
for every domain) is central in **`github.com/mmsge/naustet-server`**. Do not add a
Caddy service to this repo. To change routing or the domain, edit that repo.

**Conventions this repo must follow:**
- Lives at `/srv/mastobots`; the Compose project name is pinned (`name: mastobots`)
  so a directory rename can never orphan named volumes. The repo name is not the
  slug, which is normal on this box (`bounties` <- `bounties-deckhand`, `rpg` <-
  `river-sky`, `flipp` <- `anisocial`).
- Publish the port on `172.18.0.1:4010` or `0.0.0.0:4010` — never `127.0.0.1`
  (central Caddy dials it at `172.18.0.1:4010`).
- Set `mem_limit` (the box is 3.7 GB / 2 vCPU) and don't run heavy builds on it.
- Expose an unauthenticated `GET /healthz` (returns `200 ok`) **and** keep the
  Compose `healthcheck:` that probes it. Without the healthcheck block the
  container reports no health status to `box_health`.
- Serve `robots.txt` + `sitemap.xml` at the root (absolute URLs, correct
  content-types). `robots.txt` is a file COPY'd into the image; **`sitemap.xml`
  is generated from the bot registry**, so adding a robot cannot leave it stale.
- Every HTML page carries **git-derived creation/modification metadata** (the
  `meta name="date"`/`last-modified` pair, `article:published_time`/
  `article:modified_time`, JSON-LD `dateCreated`/`datePublished`/`dateModified`;
  `<lastmod>` in the sitemap). `scripts/generate-page-dates.sh` derives it on the
  checkout at `make deploy` (the image has no `.git`) into the gitignored
  `page-dates.json`; the app falls back to boot time when it's absent.
  **The pages deliberately send NO HTTP `Last-Modified` and no 304** — they
  render live cycle state, and a git-derived validator would let caches
  revalidate stale content. CI asserts the header's *absence*. See ADR 0009 here
  and naustet-server ADR 0015 / msge-no ADR 0004.

**Live data & full picture:** the box exposes a **Hetzner MCP at
`https://mcp.msge.no/mcp`**. Call `get_service("mastobots")`, `list_services`,
`next_free_port`, `port_map`, `conventions`, or `scaffold_service` for
authoritative, live answers. The static reference lives in `mmsge/naustet-server`
(`Caddyfile` = the port map; `services/mastobots-skvip-lol.md` = this service's doc).

## Shape of the thing

```
server.js         HTTP surface + scheduler bootstrap
logg.js           box logging module, verbatim from the skeleton
bots/*.js         one descriptor per robot — slug, account, source, composer caps
lib/config.js     env parsing; prefix-first, then house default
lib/registry.js   loads bots/, validates each descriptor
lib/source-*.js   sanity (primary) and sitemap+JSON-LD (fallback)
lib/article.js    the shared Article shape both sources return
lib/filters.js    seen, age, heading pattern, noindex policy, walls
lib/hashtags.js   publisher `name` -> CamelCase hashtag
lib/toot.js       composition + the 500-character budget
lib/mastodon.js   POST /api/v1/statuses, idempotency, backoff
lib/store.js      per-bot seen/deferred/feed store, JSON on a mounted volume
lib/feed.js       RSS 2.0
lib/poller.js     the cycle
bin/dryrun.js     compose and write to a file, never post
```

**Zero runtime dependencies.** Node 22 ships `fetch` and `node:test`, and a
service with no dependency tree never needs a security bump. There is no
`npm install` step because there is nothing to install. Keep it that way.

## Things that will bite you

- **Logging.** The article URLs, headings and slugs this service handles are
  exactly what the box's logging convention forbids logging. `article.posted`
  carries a character count and a duration; `http.request` carries `/:bot/`, not
  `/vestlendingen/`. There is no access logger and must not be one.
  **`bin/dryrun.js` writes to a file rather than stdout for this reason** —
  `logg` collects every container's stdout, `docker compose run` containers
  included (ADR 0008).
- **The noindex policy is reversible on purpose.** Held articles go to a
  `deferred` map, not to `seen`, and stay there even after they age out. That is
  what makes the editors' answer actionable whenever it arrives (ADR 0004). Don't
  "simplify" the two maps into one.
- **The fallback is real, not a stub.** It recovers the same Sanity `_id` and
  reads the same `robots.noindex` flag, so a source switch neither double-posts
  nor quietly reverses a decision (ADR 0002).
- **The JSON-LD is not in a `<script type="application/ld+json">` tag.** It lives
  inside the Next.js flight payload, escaped one level deep.
- **Field names are `heading` and `intro`**, not `title` and `description`, and
  the label on a category or tag is `name`. Guessing the obvious names returns
  nulls.
- **`publishedAt` is not a total order** on this corpus — six articles share two
  timestamps — so every sort breaks ties on `_id` (ADR 0003).
- **The heading is never truncated**, so a heading long enough on its own to blow
  the 500-character budget composes to an unpostable status. The poller refuses
  it and writes it off rather than retrying forever.

## Testing

```sh
make test        # node --test, no network — fixtures only
make dryrun      # compose against live data, post nothing -> dryrun/dryrun.txt
```

`test/corpus.test.js` pins the numbers from the plan's dry run: 8 post, 6 held
(5 noindex, 2 daily briefs, overlapping on one), longest post 304 characters,
zero truncations. If a change moves any of them, that is a decision someone
should be making on purpose.

The fixtures in `test/fixtures/` are captured from the live dataset and live
article pages. If Subrite renames `heading` or `intro`, or moves the JSON-LD out
of the flight payload, the tests fail loudly rather than the robot going quiet.

## Decision records

Non-obvious knowledge — an incident whose root cause is hard to re-derive, or a
deliberate choice between real alternatives — lives in `docs/decision-records/` as
append-only ADRs (`NNNN-short-slug.md`; update the README index). This is the same
practice used across every service on the box. **Create one when:**

- **An incident** occurs whose cause is a footgun someone could reintroduce —
  record the symptom, the trap, and the fix.
- **A specific decision** is made — a convention or config trade-off, why X instead
  of the obvious Y.

Skip routine changes with no trap and no alternative worth remembering. Records are
immutable once accepted; to change one, add a new record and mark the old
`Superseded by NNNN`. The **Contributors** field must make clear whether Markus was
*asked and answered* (name him only then) or an **agent decided on its own** (name
the agent). Add an optional `**Topics:**` line (comma-separated tags) so the record
surfaces in the pooled cross-service view at `adr.msge.no`. Decisions about central
ingress/routing/the box go in `naustet-server`; decisions about this service go
here. See `docs/decision-records/README.md`.
