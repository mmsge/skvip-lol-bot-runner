# Decision records

Short, append-only notes capturing decisions that are hard to re-derive from the
code alone — especially ones we learned the hard way. Each record explains *why*
a thing is the way it is, so we (and agents) don't undo it by accident later.

This is the **same practice used across every service on the Hetzner box** (the
central copy lives in `mmsge/naustet-server`). Each repo keeps its **own** records,
about its **own** code. If a decision is about central ingress / routing / the box
itself, record it in `naustet-server`; if it's about this service, record it here.

## Format

One file per decision: `NNNN-short-slug.md`, numbered in order. Each has:

- **Status** — `Accepted`, `Superseded by NNNN`, or `Deprecated`
- **Contributors** — who shaped the decision (see attribution rule below)
- **Topics** *(optional but encouraged)* — comma-separated tags
  (`caddy, streaming, deploy`) so the record surfaces in the cross-service topic
  view at `adr.msge.no`, which pools the ADRs of every service on the box.
- **Context** — what happened / what forced the decision
- **Decision** — what we do, concretely
- **Consequences** — trade-offs and what to watch for

Records are immutable once accepted. To change a decision, add a new record and
mark the old one `Superseded by NNNN`.

## When to write one

- **An incident occurs** whose root cause is hard to re-derive from the code — a
  footgun someone could reintroduce. Record the symptom, the trap, and the fix.
- **A specific decision is made** — a deliberate choice between real alternatives
  (a convention, a config trade-off, why we do X instead of the obvious Y).

Skip routine changes with no trap and no alternative worth remembering.

## Contributors / attribution

The Contributors field must make it obvious **whether Markus requested the
decision or an agent made it without input**:

- List **Markus** only if he was *actively asked a question and gave an answer*
  that shaped the decision. Reporting a symptom or saying "fix it" does not count.
- Otherwise mark it an **agent decision** and name the agent, e.g.
  `Claude (agent decision — no human input on the technical choice)`.
- When both: `Markus (asked & decided: <choice>) + Claude (proposed/implemented)`.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-mastodon-account-not-native-actor.md) | A Mastodon account, not a native ActivityPub actor | Accepted |
| [0002](0002-sanity-primary-sitemap-fallback.md) | Read the Sanity dataset, and keep the sitemap path working | Accepted |
| [0003](0003-key-articles-on-id.md) | Key articles on `_id`, and break ordering ties on it too | Accepted |
| [0004](0004-noindex-articles-are-not-posted.md) | Articles marked `robots.noindex` are not posted | Accepted |
| [0005](0005-daily-briefs-skipped-by-heading.md) | Skip the daily briefs by heading pattern, not by category | Accepted |
| [0006](0006-labels-from-publisher-name.md) | Hashtags come from the publisher's own `name` field | Accepted |
| [0007](0007-a-house-for-robots.md) | `mastobots` is a house for robots, not one service per robot | Accepted |
| [0008](0008-dry-run-output-is-a-file.md) | The dry run writes to a file, never to stdout | Accepted |
| [0009](0009-no-http-last-modified-on-live-pages.md) | No HTTP `Last-Modified` on the status pages | Accepted |
