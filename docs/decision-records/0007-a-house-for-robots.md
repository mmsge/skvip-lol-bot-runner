# 0007 — `mastobots` is a house for robots, not one service per robot

**Status:** Accepted
**Contributors:** Markus (asked & decided: a generic domain, so later robots share the house) + Claude (proposed/implemented the registry)
**Topics:** architecture, box-conventions, naming

## Context

The immediate need was one robot: `@vestlendingen-robot@skvip.lol`. The obvious
shape for that is a service called `vestlendingen` that does exactly it —
which is what the plan was originally written as, under the name
`vestlendingen-robot-plan.md`.

The box already shows where that leads. It hosts ~22 containers on 3.7 GB and
2 vCPU, and every service costs a port, a Caddy block, a `/srv` directory, a
service doc, a registry row, an `adr/sources.yaml` entry and a line in
`MIGRATION.md`. A second newspaper robot would repeat all of it to run the same
code against a different URL.

## Decision

**One service, `mastobots`, at `mastobots.skvip.lol`, holding a registry of
robots.** A bot is a descriptor in `bots/` — a slug, who it posts as, what it
reads, and how it composes — and everything else is bot-agnostic.

Configuration resolves **prefix first, house default second**: a bot reads
`VESTLENDINGEN_POLL_INTERVAL_MINUTES` if set, otherwise `POLL_INTERVAL_MINUTES`.
So a second robot overrides only what it disagrees with.

The token is the one setting with **no** house fallback. A shared
`MASTODON_TOKEN` would quietly post one robot's articles from another robot's
account, and that is not a failure anyone would catch quickly.

## Consequences

- Adding a robot is one file in `bots/` and a block of env vars. No port, no
  Caddy block, no new `/srv` directory, no new service doc, no `MIGRATION.md`
  row.
- Each robot gets `/<slug>/` and `/<slug>/rss.xml` automatically, and the sitemap
  is **generated from the registry** rather than maintained by hand, so a new
  robot cannot be missing from it.
- Each robot runs on its own scheduler chain, so a slow cycle for one cannot
  delay another's. Each has its own store file and its own seen set.
- The house shares one `mem_limit`, one container and one restart. A robot that
  crashes the process takes the others down with it — acceptable at this scale,
  and the reason cycle errors are caught per-bot rather than allowed to escape.
- The domain is deliberately generic. Naming it `vestlendingen.skvip.lol` would
  have made the second robot either a lie or a migration.
- **The repo name is not the slug.** `mmsge/skvip-lol-bot-runner` deploys to
  `/srv/mastobots` and serves `mastobots.skvip.lol`, with the Compose project
  pinned `name: mastobots` so the container is still attributable to the slug and
  `audit_box` does not flag it. Same arrangement as `bounties` ←
  `bounties-deckhand`, `rpg` ← `river-sky` and `flipp` ← `anisocial`.
