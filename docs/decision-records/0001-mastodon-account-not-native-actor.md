# 0001 — A Mastodon account, not a native ActivityPub actor

**Status:** Accepted
**Contributors:** Markus (asked & decided: a Mastodon account on skvip.lol) + Claude (proposed/implemented)
**Topics:** activitypub, mastodon, fediverse, bots

## Context

The robot has to appear on the fediverse as `@vestlendingen-robot@skvip.lol`.
Two ways to get there:

1. register an ordinary Mastodon account on skvip.lol and post to it through the
   REST API;
2. write a native ActivityPub actor in this service and federate directly.

Option 2 is the one that looks more like engineering, and this box already has
services that do it (`activitypub-mcp`, `konsert-activitypub`), so the capability
is not hypothetical.

## Decision

A **Mastodon account**, posted to with `POST /api/v1/statuses` and a token scoped
to `write:statuses`.

The deciding argument is the handle. **skvip.lol's webfinger belongs to
Mastodon.** A hand-rolled actor served from `mastobots.skvip.lol` could not
answer for `acct:vestlendingen-robot@skvip.lol` without taking over webfinger for
the whole instance, so option 2 does not actually deliver the address it is
supposed to deliver — it delivers `@vestlendingen-robot@mastobots.skvip.lol`,
which is a different and worse address.

Everything else follows from that and points the same way. Registering the
account gets followers, replies, boosts, search, moderation, reports and account
migration for free. A native actor means webfinger, HTTP signatures, an inbox,
a follower store and delivery retries — all of it load-bearing, none of it
related to the actual job of reading a newspaper and writing 300 characters.

## Consequences

- The service holds a token and no signing keys. It has no inbox and cannot
  receive anything, which is a feature: the robot is a publisher, not a
  correspondent. Replies land in Markus' Mastodon notifications, where a person
  can answer them.
- Moderation is skvip.lol's, which is the right place for it. If the paper ever
  objects, the account can be silenced or deleted in one action by someone who
  is not this service.
- The account's presentation is set by hand and is part of the design, not
  decoration: display name "Vestlendingen (robot)", a bio saying it is an
  unofficial automated feed run by Markus and not affiliated with Vestlendingen
  or Initiativ Media, Mastodon's **bot flag** set (which makes the ActivityPub
  type `Service` and shows the robot badge), and an avatar that is not the
  paper's logo. `bots/vestlendingen.js` records all of it, because nothing else
  in the repo would.
- `write:media` is deliberately not requested. See ADR 0002 on the preview card.
