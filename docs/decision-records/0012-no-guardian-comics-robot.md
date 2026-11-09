# 0012 — No robot that re-posts Guardian comics

**Status:** Accepted
**Contributors:** Markus (asked & decided: wanted the whole comic attached, and dropped the robot once that turned out not to be permitted) + Claude (researched the feed, the Content API tiers and the alternatives)
**Topics:** guardian, licensing, copyright, rss, images, sources

## Context

In November 2026 we designed a robot that would post each new cartoon by Edith
Pritchett, read from `https://www.theguardian.com/profile/edith-pritchett/rss`.
Each toot would carry the headline word for word, `#EdithPritchett #Comics` plus
up to two Guardian categories, a link to the article, and **the whole comic as
an attached image**. A design mockup was made. No code was written.

What we learned about the source, so nobody has to find it out again:

- **The RSS does not contain the comic.** Every `media:content` (140, 460 and
  700 px wide) is the same 5:4 trail crop of the original. The crop is encoded
  in the URL (`…/6_0_913_730/master/913.jpg`) and the URLs on `i.guim.co.uk`
  are signed (`s=`), so you cannot ask for a different crop or size. For a
  Saturday strip the crop is a single panel.
- **The feed has no standfirst for comics.** `<description>` is only a
  "Continue reading..." link. Only interactives (`/ng-interactive/`) carry real
  text, and those are scrolling pages, not one image.
- **The feed has no alt text.** The only per-image text is `media:credit`
  ("Illustration: Edith Pritchett/The Guardian").
- **Categories.** "Life and style" is on every item, so it is no use as a
  hashtag. The rest ("Politics", "Parents and parenting", …) CamelCase cleanly
  through `lib/hashtags.js`.
- **The whole comic and its alt text are only on the article page**, or in the
  Guardian Content API.
- **The Guardian answers automated page requests with a JavaScript challenge
  page** ("Client Challenge"). That covers `www.theguardian.com` (the RSS
  included) from the cloud agent containers. Scraping would have to be tested
  from the box, and could break at any time. `i.guim.co.uk` and
  `open-platform.theguardian.com` did answer.

### What the Content API allows

The Open Platform's access page (`https://open-platform.theguardian.com/access/`,
read November 2026) has two tiers:

| | Developer key (free) | Commercial key (paid) |
|---|---|---|
| Use | "any non-commercial usage of the content, such as student dissertations, hackathons, nonprofit app developers" | "In addition to app development and publishing content on third party sites, …" |
| Content | "Access to article text" | "Access to article text, images, audio and videos" |
| Limits | 1 call/s, 500 calls/day | Custom |

So the free key serves no images. Posting to a Mastodon server is "publishing
content on third party sites", which the page lists under the commercial key.
A Guardian moderator on the `guardian-api-talk` forum confirmed that images
other than the main article image need a commercial key. An older copy of the
terms limits developer-tier content to end users' "personal, non-commercial
use". The full terms page
(`https://www.theguardian.com/open-platform/terms-and-conditions`) sits behind
the same challenge page and was not read directly.

### Scraping does not get around this

The API terms only govern the API. The cartoon itself is copyrighted by the
artist and Guardian News & Media. Uploading it to skvip.lol re-hosts their work,
however it was fetched.

## Decision

**No Guardian comics robot.** In particular, none that uploads the full comic,
whether it comes from the Content API, from scraping the article page or from
anywhere else.

The alternatives were considered and not pursued:

1. **Link only.** Headline, link and tags, no attachment. Mastodon draws the
   preview card from the page's own `og:image`, which the Guardian publishes so
   other sites can show it. This is how `@botlendingen` works. It is permitted,
   but without the comic it was not the robot Markus wanted.
2. **Attach the feed's 5:4 crop.** It is lower risk than the full comic, but
   still re-hosts their image, and a single panel misrepresents a strip.
3. **Ask permission** from the Guardian or the artist, or buy a commercial key.
   Either would make the full-comic robot legitimate.

## Consequences

- If a robot for Guardian content (or any other publisher's images) comes up
  again, start from this record. A **link-only** robot is fine. **Attaching the
  publisher's images is not**, unless there is a licence or written permission.
  Record that permission in a new ADR that supersedes this one.
- Any source whose RSS images are signed crops has the same trap: what the feed
  ships is a teaser, not the work. Check the image dimensions before designing
  around "attach the image".
- The general rule for this house: a robot points at the publisher's work, it
  does not copy it. The existing robots already follow it, because they post
  only the publisher's own heading, intro and link.
