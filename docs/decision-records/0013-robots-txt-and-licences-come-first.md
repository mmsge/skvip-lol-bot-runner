# 0013 — Every robot follows robots.txt and the source's licence

**Status:** Accepted
**Contributors:** Markus (asked & decided: "I always follow robots.txt and licensing", as a standing rule for the house) + Claude (wrote it up)
**Topics:** robots-txt, licensing, copyright, sources, scraping, ethics

## Context

ADR 0012 dropped a robot that would have re-posted Guardian cartoons. The full
comic was only available behind a paid API tier or by scraping a site that
blocks automated requests. Neither the robot's design nor the code said
anything general about where the line is, so the same idea, with a different
publisher, could come up again and be judged from scratch.

Markus's position is general, not specific to the Guardian. He follows
`robots.txt` and licensing, always.

## Decision

A standing rule for every robot in this house, written into `AGENTS.md` so
agents read it before designing one:

1. **`robots.txt` is followed.** Before a robot is designed, read the source's
   `robots.txt`. Fetch only paths it allows for our User-Agent. If it disallows
   what the robot needs, the robot is not built. A challenge page, an IP block
   or a rate limit is also a no, and is not worked around (no browser
   emulation, no rotating User-Agents, no proxies).
2. **The licence is followed.** Only fetch and post what the source's terms
   allow: API tier, feed terms, and the copyright on text and images. Unclear
   terms are a question for Markus before building, not a risk to take.
3. **Robots point at the work, they don't copy it.** A toot carries the
   publisher's heading, intro and link. Uploading the publisher's images, or
   posting full text, needs an explicit licence or written permission,
   recorded in an ADR.

"It is technically reachable" and "scraping avoids the API terms" are never
reasons to go ahead.

## Consequences

- The existing robots already comply. The Sanity source reads a dataset the
  publisher made public, asks only for the fields a post needs and leaves the
  article body alone (ADR 0002). The sitemap fallback touches only paths the
  paper's `robots.txt` allows (`lib/source-sitemap.js`). `@linjeskift` reads a
  sibling service's database on the same box (ADR 0010).
- `robots.txt` is checked by a person when a robot is designed. There is no
  runtime check in the code. If a source tightens its `robots.txt` later,
  nothing notices automatically. A runtime check in `lib/http.js` would close
  that gap and is a reasonable follow-up, but it is not part of this decision.
- New source ideas get a short licensing check as part of the design, and the
  result goes in the robot's ADR, so the reasoning survives.
