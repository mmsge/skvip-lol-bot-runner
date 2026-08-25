# __SLUG__

A service on the shared Hetzner box (`msge`, `157.180.66.111`). Central TLS/routing
lives in [`mmsge/hetzner-server`](https://github.com/mmsge/hetzner-server); see
`CLAUDE.md` for the deployment context.

## From this skeleton to a live service

1. Replace `server.js` (and `Dockerfile`) with your app; keep a `/healthz` route.
2. `make verify` — builds, boots, and curls `/healthz`.
3. Register + deploy on the box — see `hetzner-server/NEW-SERVICE.md` (or ask the
   MCP: `onboarding_steps("__SLUG__", __PORT__)`).

## Local

```sh
make verify     # generate page dates + build + boot + healthz
make logs       # follow logs
make status     # container status
```

## Page dates (creation/modification metadata)

Every site on the box carries git-derived created/modified timestamps
(hetzner-server ADR 0015 / msge-no ADR 0004), and this skeleton ships the
pattern wired end to end:

- `scripts/generate-page-dates.sh` (pure git + POSIX sh) derives
  **created** (oldest commit author date) / **modified** (newest) into the
  gitignored `page-dates.json`. It runs on the **checkout** — the image has no
  `.git`, and the box has no Node outside containers — hooked into
  `make deploy`/`make verify`, and the Dockerfile `COPY`s the file in (optional
  glob, so a bare `docker build` still works with a boot-time fallback).
- `server.js` stamps the dates into the page's `<meta name="date">`/
  `last-modified` pair, `article:published_time`/`article:modified_time`, and
  the JSON-LD `WebSite` node, and serves a truthful `Last-Modified` header
  (+ 304). **Drop the header if the page becomes DB/live-data-driven** — a git
  validator would let caches revalidate stale content; keep the meta/JSON-LD.
- CI (`.github/workflows/ci.yml`) boots the server and asserts the metadata is
  present — it checks out with `fetch-depth: 0` because a shallow clone
  collapses both dates onto the newest commit.

Keep the pattern when you replace `server.js`: site-level granularity (one
created/modified pair) is the default; per-page only when pages have genuinely
distinct histories (msge.no is the per-page exemplar).

## Pull requests

This skeleton ships a shared PR template set in `.github/` (copied verbatim into
every service, so box-wide conventions — deploy discipline, "central ingress lives in
`hetzner-server`", web standards, ADRs + attribution — are prompted at review time):

- `.github/pull_request_template.md` — the default, used by the green **Create PR** button.
- `.github/PULL_REQUEST_TEMPLATE/{feature,fix,adr,chore}.md` — pick one by appending
  `?template=NAME.md` to the compare URL, e.g.
  `.../compare/hovud...my-branch?expand=1&template=fix.md`.

The `__SLUG__` in the templates is replaced by the same scaffold `sed` pass that fills
in the rest of the skeleton.

## Licence

AGPL-3.0 (`SPDX-License-Identifier: AGPL-3.0-or-later`) — see `LICENSE`. Keep the
`NOTICE` (it carries the AI-authorship disclosure); fill in `<PROJECT>`/`<YEAR>` when
you scaffold. Built with AI — [Laga med KI](https://msge.no/ki). Box-wide policy:
`hetzner-server/docs/licensing/` + ADR 0018.
