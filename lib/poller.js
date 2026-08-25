// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The cycle.
 *
 * Once per interval, per bot: read the source, decide what posts, post it,
 * remember it. Everything interesting about this service that is not a decision
 * about wording is here.
 *
 * The logging rules bite hardest in this file. An article URL, heading or slug
 * must never reach the central log store, so the events below carry counts,
 * durations and the bot slug — and nothing that identifies a piece of writing or
 * the person who wrote it. `article.posted` is a count and a duration.
 */
const { logg } = require("../logg");
const sanity = require("./source-sanity");
const sitemap = require("./source-sitemap");
const { evaluate, tally } = require("./filters");
const { composeToot, LIMIT } = require("./toot");
const { MastodonClient, idempotencyKey, withBackoff } = require("./mastodon");
const { toFeedItem } = require("./feed");
const { Store } = require("./store");

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Holds that are a judgement about the article itself, and will never be revised.
const PERMANENT_HOLDS = new Set(["daily-brief", "no-heading", "no-date"]);

/**
 * Should this hold be deferred rather than written off?
 *
 * Only the noindex policy is still open, so only a noindex hold defers — but it
 * defers even once the article is also too old to post, which is the case that
 * matters. The editors' answer may well arrive after the 72-hour window has
 * closed on these five articles, and writing them off at 72 hours would mean
 * flipping NOINDEX_POLICY afterwards did nothing at all. Deferred, the answer
 * is worth something concrete: set the policy and raise MAX_ARTICLE_AGE_HOURS
 * for one cycle, and they post (ADR 0004).
 *
 * A daily brief or a headless article is a judgement about the article itself
 * and is never revisited, so those are written off even when noindex is also
 * set — which is exactly "Torsdag 20. august", the one article that is both.
 */
function isDeferrable(evaluation) {
  return (
    evaluation.reasons.includes("noindex") &&
    !evaluation.reasons.some((reason) => PERMANENT_HOLDS.has(reason))
  );
}

/**
 * Read the source, falling back once.
 *
 * A Sanity failure is expected to be rare and temporary, so the first one logs
 * at info; two in a row means something has actually changed upstream and the
 * level rises to warn. Both sources failing is an error, and the cycle posts
 * nothing rather than guessing.
 */
async function readSource(bot, config, store, deps) {
  const { publicBaseUrl, sleep } = deps;
  try {
    const articles = await sanity.fetchArticles(config, {
      limit: bot.fetchLimit,
      publicBaseUrl,
    });
    bot.sanityFailures = 0;
    return { source: sanity.SOURCE, articles };
  } catch (err) {
    bot.sanityFailures = (bot.sanityFailures || 0) + 1;
    const level = bot.sanityFailures >= 2 ? "warn" : "info";
    logg[level]("source.sanity.unavailable", {
      err,
      extra: { bot: bot.slug, consecutive: bot.sanityFailures },
    });
  }

  const articles = await sitemap.fetchArticles(config, {
    // Only fetch pages for articles this bot has not already decided about.
    // A normal fallback cycle therefore fetches the sitemap and nothing else.
    isKnown: (loc, slug) => store.isKnownKey(`slug:${slug}`),
    maxFetch: Math.max(1, config.maxPostsPerCycle),
    publicBaseUrl,
    sleep,
  });
  return { source: sitemap.SOURCE, articles };
}

/**
 * The first run marks the current corpus without posting, so the account starts
 * quiet instead of dumping an archive into people's timelines.
 *
 * Articles that would be held on noindex are DEFERRED rather than marked, so
 * the answer from the paper's editors is still actionable afterwards — the whole
 * reason NOINDEX_POLICY stayed a config value (ADR 0004).
 */
async function bootstrap(bot, config, store, articles, now) {
  const noindexHeld = [];
  const rest = [];
  for (const article of articles) {
    const evaluation = evaluate(article, config, { now, ignoreAge: true, ignoreSeen: true });
    if (!evaluation.post && isDeferrable(evaluation)) noindexHeld.push(article);
    else rest.push(article);
  }
  store.markArticles(rest);
  store.deferArticles(noindexHeld);
  await store.save();
  logg.info("bot.bootstrapped", {
    extra: { bot: bot.slug, marked: rest.length, deferred: noindexHeld.length },
  });
}

/**
 * Post one article, or pretend to.
 *
 * The article is marked handled and the store saved BEFORE the next post is
 * attempted, so a crash mid-batch cannot lose the record of what already went
 * out. The idempotency key covers the narrower window between Mastodon
 * accepting the status and the store landing on disk.
 */
async function postOne(bot, config, store, client, article, evaluation, toot, deps) {
  const t0 = Date.now();

  if (config.dryRun) {
    logg.info("article.dryrun", {
      dur_ms: Date.now() - t0,
      extra: { bot: bot.slug, chars: toot.chars, truncated: toot.truncated },
    });
  } else {
    await withBackoff(
      () =>
        client.postStatus({
          status: toot.text,
          language: config.language,
          visibility: evaluation.visibility,
          idempotencyKey: idempotencyKey(bot.slug, article.id),
        }),
      { sleep: deps.sleep },
    );
    logg.info("article.posted", {
      dur_ms: Date.now() - t0,
      extra: { bot: bot.slug, chars: toot.chars, truncated: toot.truncated },
    });
  }

  store.markArticles([article]);
  await store.save();
  return toot;
}

/**
 * Run one cycle for one bot. Returns the summary the status page renders.
 */
async function runCycle(bot, config, store, deps = {}) {
  const {
    now = Date.now(),
    publicBaseUrl = "",
    sleep = defaultSleep,
    client = new MastodonClient({ baseUrl: config.mastodonBaseUrl, token: config.token }),
  } = deps;
  const startedAt = Date.now();

  let read;
  try {
    read = await readSource(bot, config, store, { publicBaseUrl, sleep });
  } catch (err) {
    // Both paths are gone. Post nothing, keep everything unseen, try again next
    // cycle — an article that was never read is an article that is still new.
    logg.error("source.all.failed", { err, extra: { bot: bot.slug } });
    const summary = {
      at: new Date(now).toISOString(),
      source: null,
      fetched: 0,
      posted: 0,
      held: 0,
      reasons: {},
      error: "both sources unavailable",
      dryRun: config.dryRun,
    };
    store.setLastCycle(summary);
    await store.save();
    return summary;
  }

  const { source, articles } = read;

  // A first run on an empty store marks the corpus instead of posting it,
  // unless BACKFILL says otherwise.
  if (!store.seen.size && !store.deferred.size && !config.backfill) {
    await bootstrap(bot, config, store, articles, now);
  }

  const evaluations = articles.map((article) => ({
    article,
    ...evaluate(article, config, { now, isSeen: (a) => store.hasArticle(a) }),
  }));

  // The feed remembers everything that passes the CONTENT filters, whether or
  // not it posted this cycle — age and the seen store are about when to post,
  // not about what the paper published. Without that, the feed would start
  // empty after the first run and take months to become useful.
  store.rememberForFeed(
    articles
      .filter((a) => evaluate(a, config, { now, ignoreAge: true, ignoreSeen: true }).post)
      .map(toFeedItem),
  );

  const postable = evaluations
    .filter((e) => e.post)
    // Oldest first: the timeline then reads in the order the paper published,
    // and a burst larger than MAX_POSTS_PER_CYCLE drains in order rather than
    // leaving the oldest articles to starve behind newer ones.
    .reverse()
    .slice(0, config.maxPostsPerCycle);

  // Held for a reason that will never change gets written off; held on the
  // noindex policy is deferred, so a policy answer can still bring it back.
  const held = evaluations.filter((e) => !e.post && !e.reasons.includes("seen"));
  const deferrable = held.filter(isDeferrable);
  // Everything else is written off. Leaving it unknown would have the fallback
  // re-fetch its page every cycle all through an outage, for no information.
  const settled = held.filter((e) => !isDeferrable(e));

  let posted = 0;
  let failed = 0;
  let oversized = 0;
  for (const [i, evaluation] of postable.entries()) {
    const toot = composeToot(evaluation.article, bot.composer);

    // Only the intro is trimmed, so a heading long enough on its own to blow the
    // budget composes to an unpostable status. Mastodon would reject it with a
    // 422, which is not retryable — and because a failed article stays unseen,
    // it would come back every cycle forever. Write it off instead, loudly.
    if (toot.chars > LIMIT) {
      oversized += 1;
      logg.warn("article.oversized", {
        extra: { bot: bot.slug, chars: toot.chars, limit: LIMIT },
      });
      store.markArticles([evaluation.article]);
      await store.save();
      continue;
    }

    try {
      if (i > 0 && config.postSpacingSeconds) await sleep(config.postSpacingSeconds * 1000);
      await postOne(bot, config, store, client, evaluation.article, evaluation, toot, { sleep });
      posted += 1;
    } catch (err) {
      // Leave it unseen. Next cycle picks it up again, and the idempotency key
      // means a status that did land is not duplicated.
      failed += 1;
      logg.error("article.post.failed", { err, extra: { bot: bot.slug } });
    }
  }

  store.deferArticles(deferrable.map((e) => e.article));
  store.markArticles(settled.map((e) => e.article));

  const summary = {
    at: new Date(now).toISOString(),
    source,
    fetched: articles.length,
    posted,
    failed,
    oversized,
    held: held.length,
    deferred: store.deferredArticles,
    // Tallied over `held`, not over every non-posting article: counting the
    // already-seen ones too would print a reason breakdown that does not add up
    // to the held count next to it.
    reasons: tally(held),
    error: null,
    dryRun: config.dryRun,
  };
  store.setLastCycle(summary);
  await store.save();

  logg.info("cycle.finished", {
    dur_ms: Date.now() - startedAt,
    extra: {
      bot: bot.slug,
      source,
      fetched: articles.length,
      posted,
      failed,
      held: held.length,
    },
  });
  return summary;
}

/**
 * Schedule a bot's cycle forever.
 *
 * `setTimeout` chained after each run rather than `setInterval`, so a slow cycle
 * (twenty seconds between posts, five posts) can never overlap the next one.
 */
function schedule(runOnce, intervalMinutes, { timer = setTimeout } = {}) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await runOnce();
    } catch (err) {
      logg.error("cycle.failed", { err });
    }
    if (!stopped) timer(tick, intervalMinutes * 60 * 1000).unref?.();
  };
  tick();
  return () => {
    stopped = true;
  };
}

module.exports = { runCycle, schedule, readSource, bootstrap, isDeferrable, Store };
