# mastobots

A house for Mastodon robots, on the shared Hetzner box (`msge`). Each robot reads
a source and posts new articles to a Mastodon account on skvip.lol.

One robot lives here today: **[@botlendingen@skvip.lol](https://skvip.lol/@botlendingen)**,
which posts new articles from [vestlendingen.no](https://www.vestlendingen.no) —
a paper that publishes no feed of its own, so this house
[serves one for it](https://mastobots.skvip.lol/vestlendingen/rss.xml).

Repo `mmsge/skvip-lol-bot-runner`; the service slug is `mastobots`. Central
TLS/routing lives in [`mmsge/naustet-server`](https://github.com/mmsge/naustet-server);
see `AGENTS.md` for the deployment context.

## What a post looks like

```
– Heimekontor-forbod: Ein gåvepakke til Oslo-staten

Du får ikkje dei beste folka ved å tvinge dei inn til Oslo-kontoret, skriv Alfred Bjørlo.

https://www.vestlendingen.no/artikler/heimekontor-forbod-ein-gavepakke-til-oslo-staten

#Vestlandet #nyhende #Kommentar
```

The paper's own wording, verbatim, no translation and no commentary of ours.
Heading, intro, link, hashtags — never the article body, which the robot can read
and will not. The photograph arrives through Mastodon's own link preview card
rather than as uploaded media, so the same picture is never shown twice.

**The robot is unmistakably a third party.** Display name "Vestlendingen
(robot)", a bio saying it is an unofficial automated feed and not affiliated with
Vestlendingen or Initiativ Media, Mastodon's bot flag set, and an avatar that is
not their logo.

## How it works

```
        every 15 min, per bot
                 │
                 ▼
      ┌──────────────────────┐  1 GROQ query
      │  source: sanity      │ ─────────────▶ 6bxsir9v.apicdn.sanity.io
      └──────────┬───────────┘
                 │  fails? ──▶ source: sitemap + article JSON-LD
                 ▼
      ┌──────────────────────┐
      │  filter              │  seen, age, heading pattern, noindex, walls
      └──────────┬───────────┘
                 ▼
      ┌──────────────────────┐
      │  composer            │  500-char budget, URL counts as 23
      └──────────┬───────────┘
                 ▼
      ┌──────────────────────┐  POST /api/v1/statuses + Idempotency-Key
      │  mastodon client     │ ─────────────▶ skvip.lol
      └──────────────────────┘
```

| Route | What |
|---|---|
| `/` | index of the robots living here, with last cycle and source used |
| `/vestlendingen/` | that robot's status page |
| `/vestlendingen/rss.xml` | **the feed vestlendingen.no does not have** |
| `/healthz` | box convention |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | box convention |

## Adding a robot

One file in `bots/`, and a block of env vars. No port, no Caddy block, no new
service (ADR 0007).

```js
module.exports = {
  slug: "dømet",
  title: "Dømet (robot)",
  account: "@domet-robot@skvip.lol",
  summary: "Ein uoffisiell robot som legg ut nye saker frå døme.no.",
  publisher: { name: "Døme", homepage: "https://www.dome.no", hasFeed: false },
  fetchLimit: 20,
  maxCategories: 2,
  maxTags: 3,
  feed: { title: "Dømet (robot)", description: "…", language: "no" },
};
```

Then set `DØMET_MASTODON_TOKEN` and any setting it disagrees with. Everything
resolves prefix-first, so `DOMET_POLL_INTERVAL_MINUTES` beats
`POLL_INTERVAL_MINUTES`, and unset settings fall through to the house default.

The token is the one setting with **no** house fallback — a shared token would
post one robot's articles from another robot's account.

## Local

```sh
make test        # node --test, no network — fixtures only
make verify      # build + boot + healthz
make dryrun      # compose against live data, post nothing → dryrun/dryrun.txt
make logs        # follow logs
```

`bin/dryrun.js` writes the composed posts to a **file**, not stdout: the central
`logg` service collects every container's stdout, and the composed posts are
headings, intros and URLs — exactly what the box's logging convention forbids
storing. Only counts are printed. See ADR 0008.

## Deploying

```sh
ssh msge 'cd /root/naustet-server && make add-subdomain SUBDOMAIN=mastobots DOMAIN=skvip.lol PORT=4010'
ssh msge 'git clone git@github.com:mmsge/skvip-lol-bot-runner.git /srv/mastobots'
scp .env msge:/srv/mastobots/.env
ssh msge 'cd /srv/mastobots && make deploy'
ssh msge 'cd /srv/mastobots && make dryrun && cat /srv/mastobots/dryrun/dryrun.txt'
```

Flip `DRY_RUN=0` when the output reads correctly. The **first run marks every
currently published article seen without posting**, so the account starts quiet;
`BACKFILL=1` overrides that.

Then fill in `naustet-server/services/mastobots-skvip-lol.md` and commit.

## Configuration

Every setting is documented in `.env.example`. The ones worth knowing about:

| Variable | Default | Why |
|---|---|---|
| `VESTLENDINGEN_MASTODON_TOKEN` | none | scope `write:statuses` only |
| `VESTLENDINGEN_NOINDEX_POLICY` | `skip` | `skip`, `unlisted` or `post` — see ADR 0004 |
| `VESTLENDINGEN_SKIP_HEADING_PATTERN` | the weekday regex | the daily briefs, ADR 0005 |
| `MAX_POSTS_PER_CYCLE` | `5` | a bulk publish cannot flood the timeline |
| `MAX_ARTICLE_AGE_HOURS` | `72` | an edited old article does not resurface |
| `DRY_RUN` | `0` | compose and log, never post |
| `BACKFILL` | `0` | first run marks existing articles seen |

### The noindex question

Five of the paper's fourteen articles carry `robots.noindex`, and nobody outside
the paper can say whether that is launch-window housekeeping or deliberate
duplicate-content suppression. The robot **skips them**, because skipping is
undone by flipping one variable and posting is not undone from other people's
timelines (ADR 0004).

Held articles are **deferred, not written off** — they stay actionable even after
they age out. When the editors answer, if the flag turns out to be housekeeping:

```sh
# in .env
VESTLENDINGEN_NOINDEX_POLICY=post
MAX_ARTICLE_AGE_HOURS=8760     # for one cycle, then put it back
```

## Decision records

`docs/decision-records/` — nine of them, covering why this is a Mastodon account
rather than a native actor, why the Sanity dataset is read at all and what the
manners are, why articles are keyed on `_id`, the noindex decision, the daily
briefs, the hashtag derivation, the house architecture, why the dry run writes to
a file, and why the pages send no `Last-Modified`.

## Licence

AGPL-3.0 (`SPDX-License-Identifier: AGPL-3.0-or-later`) — see `LICENSE`. Keep the
`NOTICE` (it carries the AI-authorship disclosure). Built with AI —
[Laga med KI](https://msge.no/ki). Box-wide policy:
`naustet-server/docs/licensing/` + ADR 0018.
