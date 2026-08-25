# 0009 — No HTTP `Last-Modified` on the status pages

**Status:** Accepted
**Contributors:** Claude (agent decision — no human input on the technical choice)
**Topics:** caching, box-conventions, page-dates

## Context

Every site on the box carries git-derived created/modified metadata, and the Node
skeleton ships the pattern wired end to end — including an HTTP `Last-Modified`
header and a 304 response, both derived from `page-dates.json`. The skeleton's
CI asserts that the 304 works.

That is correct for the skeleton, whose page is static. It is wrong here. The
index and the bot status pages render **live cycle state** — when the last cycle
ran, which source it used, how many articles posted, how many are held. That
changes every fifteen minutes; the git dates change when someone commits.

Serving a git-derived validator on a live page tells caches that a page which
changed four times an hour has not changed since the last deploy.

## Decision

- The pages keep the **metadata**: `meta name="date"` / `last-modified`,
  `article:published_time` / `article:modified_time`, and JSON-LD
  `dateCreated` / `datePublished` / `dateModified`. That is what the convention
  is actually about, and it is truthful — it describes the *site*, not the data.
- The pages do **not** send an HTTP `Last-Modified` header, and do not answer
  304.
- `sitemap.xml` keeps its `<lastmod>`, which is a site-level claim and true.
- CI asserts the metadata is present **and that the header is absent**, so the
  skeleton's 304 test cannot be restored by someone tidying up.

## Consequences

- The box convention is followed rather than bent: it says HTTP `Last-Modified`
  only while a page stays static, never on live-data-driven pages.
- Anyone copying this service as a starting point inherits the correct behaviour
  for a live page, and the CI assertion explains why if they try to change it.
- The RSS feed carries `lastBuildDate` from the last cycle, which is a real
  timestamp for the data rather than a git one.
