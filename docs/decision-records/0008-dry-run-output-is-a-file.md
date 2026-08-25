# 0008 — The dry run writes to a file, never to stdout

**Status:** Accepted
**Contributors:** Claude (agent decision — no human input on the technical choice)
**Topics:** logging, privacy, box-conventions, tooling

## Context

`bin/dryrun.js` composes every post the robot would make and shows it, so a
human can read the output before flipping `DRY_RUN=0`. The obvious
implementation prints to stdout, and that is how the original `vl-dryrun.mjs`
worked on a laptop.

On the box it is a trap, and a quiet one.

The composed posts are article **headings, intros and URLs**. The box's logging
convention says never to log free-text content or a concrete path carrying an
identifier — and the central `logg` service collects **every container's
stdout** through the read-only socket proxies. A one-off `docker compose run`
container is still a container, and its name starts with `mastobots-`, so it is
attributed to this service and collected like any other.

So `make dryrun`, implemented the obvious way, would file the paper's headlines
into the central log store, show up as a redaction hit at
`logs.msge.no/etterleving`, and do it under the name of a command whose entire
purpose is to be safe to run.

## Decision

**The dry run writes the composed posts to a file. Only counts go to stdout.**

- Default output is `${DATA_DIR}/dryrun.txt`; `--out <path>` picks another.
- `make dryrun` bind-mounts `./dryrun` into the container and writes there, so
  the file is read on the host with a plain `cat` — no second container, and
  nothing to collect.
- stdout gets one JSON line of counts (`dryrun.finished`) and the output path.
- `--stdout` exists as an explicit opt-in for running this on a laptop, and is
  documented as never to be used on the box.

## Consequences

- `make dryrun` is safe to run on the box, which is the whole point of having it.
- The `dryrun/` directory is gitignored.
- The same reasoning constrains the poller, and is why `article.posted` carries a
  character count and a duration rather than anything about the article, and why
  `http.request` logs `/:bot/` rather than `/vestlendingen/`.
- The general shape of the trap is worth remembering beyond this service: **any
  CLI in a container that prints user or third-party content is writing to the
  central log store**, whether or not it thinks of itself as logging.
