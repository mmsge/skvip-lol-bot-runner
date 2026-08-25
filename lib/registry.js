// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The registry: what robots live in this house.
 *
 * A bot is a small descriptor — a slug, who it posts as, where it reads from,
 * and how it composes — and nothing else. The machinery around it is
 * bot-agnostic on purpose: adding a second robot is one file in `bots/` and a
 * block of env vars, not another service on the box (ADR 0007).
 */
const fs = require("node:fs");
const path = require("node:path");
const { botConfig, assertPostable } = require("./config");

const BOTS_DIR = path.join(__dirname, "..", "bots");

class RegistryError extends Error {}

/**
 * Check a descriptor before anything depends on it.
 *
 * A bad descriptor is a deployment mistake, and a house that boots with a
 * half-valid robot in it is harder to debug than one that refuses to boot.
 */
function validate(bot, file) {
  const where = `bots/${file}`;
  const require_ = (field, test, expected) => {
    if (!test) throw new RegistryError(`${where}: \`${field}\` ${expected}`);
  };

  require_("slug", typeof bot.slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(bot.slug),
    "must be a lowercase slug (letters, digits, hyphens)");
  require_("title", typeof bot.title === "string" && bot.title.length > 0,
    "must be a non-empty string");
  require_("account", typeof bot.account === "string" && bot.account.startsWith("@"),
    "must be the robot's full handle, e.g. @name@skvip.lol");
  require_("publisher", bot.publisher && typeof bot.publisher.name === "string",
    "must name the publication the robot reads");
  require_("fetchLimit", Number.isInteger(bot.fetchLimit) && bot.fetchLimit > 0,
    "must be a positive integer");
  return bot;
}

/** Load every descriptor in `bots/`, sorted by slug so the index is stable. */
function loadDescriptors(dir = BOTS_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
  const bots = files.map((file) => validate(require(path.join(dir, file)), file));

  const seen = new Set();
  for (const bot of bots) {
    if (seen.has(bot.slug)) throw new RegistryError(`duplicate bot slug: ${bot.slug}`);
    seen.add(bot.slug);
  }
  return bots;
}

/**
 * Resolve a descriptor against the environment into a runnable bot.
 *
 * The composer options are assembled here rather than in the descriptor,
 * because the base hashtags are configurable per deployment while the caps are
 * a property of how this particular robot writes.
 */
function prepare(descriptor, env = process.env) {
  const config = botConfig(descriptor, env);
  const bot = {
    ...descriptor,
    sanityFailures: 0,
    composer: {
      baseHashtags: config.baseHashtags,
      maxCategories: descriptor.maxCategories ?? 2,
      maxTags: descriptor.maxTags ?? 3,
    },
  };
  return { bot, config };
}

/** Load and resolve every bot. Throws on the first bad descriptor or config. */
function load(env = process.env, { dir = BOTS_DIR, requirePostable = true } = {}) {
  return loadDescriptors(dir).map((descriptor) => {
    const prepared = prepare(descriptor, env);
    if (requirePostable) assertPostable(prepared.config);
    return prepared;
  });
}

module.exports = { load, loadDescriptors, prepare, validate, RegistryError, BOTS_DIR };
