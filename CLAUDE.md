# __SLUG__

<!-- Deployment & box context — KEEP this block. It is what a single-repo agent
     needs to work on this service safely without seeing the rest of the box. -->

## Deployment (Hetzner box)

| Key | Value |
|-----|-------|
| Slug / dir | `__SLUG__` → `/srv/__SLUG__` |
| Domain | `__SLUG__.msge.no` |
| Host port | `__PORT__` (bound `172.18.0.1:__PORT__`) |
| Runtime | Docker Compose |
| Deploy | `cd /srv/__SLUG__ && make deploy` |

**Central ingress — do NOT manage TLS/routing here.** Caddy (TLS + reverse proxy
for every domain) is central in **`github.com/mmsge/hetzner-server`**. Do not add a
Caddy service to this repo. To change routing or the domain, edit that repo.

**Conventions this repo must follow:**
- Lives at `/srv/__SLUG__`; the Compose project name is pinned (`name: __SLUG__`) so a
  directory rename can never orphan named volumes.
- Publish the port on `172.18.0.1:__PORT__` or `0.0.0.0:__PORT__` — never `127.0.0.1`
  (central Caddy dials it at `172.18.0.1:__PORT__`).
- Set `mem_limit` (the box is 3.7 GB / 2 vCPU) and don't run heavy builds on it.
- Expose an unauthenticated `GET /healthz` (returns `200 ok`) **and** keep the
  Compose `healthcheck:` that probes it — both ship in this skeleton. Without the
  healthcheck block the container reports no health status to `box_health`.
- Every HTML page carries **git-derived creation/modification metadata** (the
  `meta name="date"`/`last-modified` pair, `article:published_time`/
  `article:modified_time`, JSON-LD `dateCreated`/`datePublished`/`dateModified`;
  `<lastmod>` in any sitemap). `scripts/generate-page-dates.sh` derives it on the
  checkout at `make deploy` (the image has no `.git`) into the gitignored
  `page-dates.json`; the app falls back to boot time when it's absent. Ships wired
  in this skeleton — keep it when replacing `server.js`. HTTP `Last-Modified`
  (+ 304) only while the page stays static, never on DB/live-data-driven pages.
  See hetzner-server ADR 0015 / msge-no ADR 0004.

**Live data & full picture:** the box exposes a **Hetzner MCP at
`https://mcp.msge.no/mcp`** (bearer token). Call `get_service("__SLUG__")`,
`list_services`, `next_free_port`, `port_map`, `conventions`, or `scaffold_service`
for authoritative, live answers. The static reference lives in `mmsge/hetzner-server`
(`Caddyfile` = the port map; `services/__SLUG__-msge-no.md` = this service's doc).

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
the agent). Decisions about central ingress/routing/the box go in `hetzner-server`;
decisions about this service go here. See `docs/decision-records/README.md`.
