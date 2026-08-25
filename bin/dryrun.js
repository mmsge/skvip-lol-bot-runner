#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Compose every article the robot would post, and print it. Posts nothing.
 *
 * This is the script the plan was written from: its GROQ query, article shape,
 * hashtag derivation and character budget are the ones the service ships with,
 * because they are literally the same modules.
 *
 * Two deliberate differences from a live cycle:
 *
 *   - the seen store is ignored, so every article is composed rather than only
 *     the new ones;
 *   - MAX_ARTICLE_AGE_HOURS is ignored, so the June article shows up as
 *     postable. A live cycle would hold it on age, and the first run marks it
 *     seen either way.
 *
 * **The output goes to a FILE, not to stdout, and that is load-bearing.** The
 * composed posts are article headings, intros and URLs — exactly what the box's
 * logging convention says must never be logged — and `logg` collects every
 * container's stdout, one-off `docker compose run` containers included. Printing
 * the dry run would file the paper's headlines into the central log store. Only
 * counts go to stdout. See ADR 0008.
 */
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("../lib/registry");
const { serviceConfig } = require("../lib/config");
const sanity = require("../lib/source-sanity");
const { evaluate, tally } = require("../lib/filters");
const { composeToot } = require("../lib/toot");

function parseArgs(argv) {
  const args = { out: null, stdout: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[i + 1];
    // Explicit opt-in, for running this on a laptop where nothing is collecting
    // stdout. Never use it on the box.
    else if (argv[i] === "--stdout") args.stdout = true;
  }
  return args;
}

function renderBot({ bot, config }, articles) {
  const lines = [];
  const say = (s = "") => lines.push(s);

  const evaluations = articles.map((article) => ({
    article,
    ...evaluate(article, config, { ignoreAge: true, ignoreSeen: true }),
  }));
  const postable = evaluations.filter((e) => e.post);
  const held = evaluations.filter((e) => !e.post);

  say(`=== ${bot.slug} — ${bot.title} (${bot.account}) ===`);
  say(`fetched ${articles.length} · would post ${postable.length} · held ${held.length}`);
  say(`noindex policy: ${config.noindexPolicy} · language: ${config.language} · visibility: ${config.visibility}`);
  say();

  let longest = 0;
  let shortest = Infinity;
  let truncations = 0;

  for (const evaluation of postable.slice().reverse()) {
    const toot = composeToot(evaluation.article, bot.composer);
    longest = Math.max(longest, toot.chars);
    shortest = Math.min(shortest, toot.chars);
    if (toot.truncated) truncations += 1;
    say("-".repeat(72));
    const flags = [
      `${toot.chars}/500 chars`,
      evaluation.visibility,
      evaluation.article.image ? "has image" : "NO image",
      toot.truncated ? "TRUNCATED" : null,
    ].filter(Boolean);
    say(`[${flags.join(" · ")}]`);
    say();
    say(toot.text);
    say();
  }

  say("=".repeat(72));
  say("HELD:");
  for (const evaluation of held.slice().reverse()) {
    say(`  ${evaluation.reasons.join(" + ").padEnd(24)} ${evaluation.article.heading}`);
  }
  say();
  const counts = tally(held);
  say(`held by reason: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`);
  if (postable.length) {
    say(`characters: longest ${longest}, shortest ${shortest}, truncations ${truncations}`);
  }

  return {
    text: lines.join("\n"),
    summary: {
      slug: bot.slug,
      fetched: articles.length,
      wouldPost: postable.length,
      held: held.length,
      reasons: counts,
      longest,
      shortest: shortest === Infinity ? 0 : shortest,
      truncations,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const service = serviceConfig();
  // No token needed: this never posts.
  const bots = load(process.env, { requirePostable: false });

  const chunks = [];
  const summaries = [];
  for (const entry of bots) {
    const articles = await sanity.fetchArticles(entry.config, {
      limit: entry.bot.fetchLimit,
      publicBaseUrl: service.publicBaseUrl,
    });
    const rendered = renderBot(entry, articles);
    chunks.push(rendered.text);
    summaries.push(rendered.summary);
  }
  const body = `${chunks.join("\n\n")}\n`;

  if (args.stdout) {
    process.stdout.write(body);
  } else {
    const out = args.out || path.join(service.dataDir, "dryrun.txt");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body, "utf8");
    // Counts only. Anything more would put the paper's headlines in the log.
    process.stdout.write(`${JSON.stringify({ event: "dryrun.finished", bots: summaries })}\n`);
    process.stdout.write(`wrote composed posts to ${out}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`dryrun failed: ${err.message}\n`);
  process.exit(1);
});
