# 0002 — Read the Sanity dataset, and keep the sitemap path working

**Status:** Accepted
**Contributors:** Claude (agent decision — no human input on the technical choice)
**Topics:** scraping, data-sources, resilience, manners

## Context

vestlendingen.no publishes **no RSS or Atom feed**. Confirmed absent: `/rss`,
`/rss.xml`, `/feed`, `/feed.xml`, `/atom.xml`, `/artikler/rss`, and there is no
`<link rel="alternate" type="application/rss+xml">` anywhere in the markup.

The site is Subrite Publish (Initiativ Media AS) — Next.js on Vercel with
**Sanity** behind it. Probing turned up three usable surfaces:

| Surface | What it gives |
|---|---|
| Sanity dataset `6bxsir9v/production` | full structured documents, no token needed |
| `/articles/sitemap/0.xml` | URLs and `lastmod`, newest first |
| article HTML | JSON-LD inside the Next.js flight payload |

The dataset is readable without authentication and returns everything a post
needs in one GROQ query.

## Decision

**Sanity is the primary source; the sitemap plus the article page is a
first-class fallback, not a stub.**

Nothing here is prohibited. The paper's `robots.txt` is `Allow: /` with
`Disallow:` on `/_next/`, `/api/` and `/auth/` — so the fallback path is
explicitly invited, and the `/api/` line covers their own host, not Sanity's CDN.
What governs the dataset is Sanity's dataset visibility setting, which the
publisher has set to public deliberately.

What it is **not** is a *published* interface. It can change or close without
notice, and reading it is a courtesy relationship rather than a contract. So the
manners are part of the design:

- query the **CDN** endpoint (`apicdn`), never the origin API;
- one request per cycle, fifteen minutes apart, with a User-Agent naming the
  robot and where to reach its operator;
- request only the fields a post needs. **The article `body` is in the dataset
  and is deliberately not requested.**
- **tell the editors** the robot exists.

The fallback exists so that no single upstream decision can silence the robot. It
reads, in descending order of quality: the JSON-LD `Article` node, then
`<meta name="robots">`, then `<h1>` plus the following `<p class="text-xl">`.

## Consequences

- **The JSON-LD is not in a `<script type="application/ld+json">` tag.** The
  served HTML has none. It sits inside the Next.js flight payload, escaped one
  level deep inside a `self.__next_f.push([1,"…"])` string, and has to be
  unescaped before it will parse. A reader that looks for the script tag finds
  nothing and concludes, wrongly, that the page has no structured data.
- **The fallback can see `robots.noindex`.** The article page carries
  `<meta name="robots" content="noindex">` on exactly the articles whose Sanity
  flag is set. Without that, a Sanity outage would start posting the articles
  ADR 0004 holds back — the fallback would have quietly reversed a decision.
- **The fallback recovers the same `_id`.** The article page carries exactly one
  UUID-shaped string and it is the Sanity document id, so an article handled by
  one source is recognised by the other and cannot post twice. The article's slug
  is stored as an alias key as well, so the guarantee survives even if id
  recovery stops working.
- **The fallback loses article tags.** The JSON-LD carries `articleSection` (the
  category) but no `keywords`, even on the one article that has five tags. A
  fallback post gets base hashtags plus the category: thinner, not wrong.
- The fallback fetches only article pages it has not already decided about, so a
  normal fallback cycle fetches the sitemap and nothing else.
- **No personal data is read.** Author documents carry no `name`, `email` or
  `phone`; the newsletter documents carry no recipient list. Bylines are dropped
  from the query rather than chased, and the posts do not use them.
- The photograph reaches the timeline through Mastodon's own **link preview
  card**, built from the `og:image` the article already serves — never as
  uploaded media, which would show the same picture twice. One caveat: the site
  serves `og:title` and `og:image` but **no `og:description`**, so cards render
  as a large image and a headline with an empty body. Thinner than a normal news
  card, and not something this service can fix.
- If they close the dataset or ask us to stay out of it, the robot degrades to
  the fallback instead of dying, and the fallback uses only what `robots.txt`
  invites.
