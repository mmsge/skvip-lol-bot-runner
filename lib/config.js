// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Environment parsing — one place, failing loudly.
 *
 * Every setting resolves the same way: a bot's own `VESTLENDINGEN_`-prefixed
 * variable wins, and the unprefixed name is the house default. That is what
 * makes this a house rather than one service per robot — a second bot overrides
 * only what it disagrees with, and nothing has to be restructured to let it
 * (ADR 0007). The token is the one exception: it is prefix-only, because a
 * fallback there would quietly post one bot's articles from another bot's
 * account.
 */
const { DEFAULT_SKIP_HEADING_PATTERN, NOINDEX_POLICIES } = require("./filters");

const DEFAULTS = {
  MASTODON_BASE_URL: "https://skvip.lol",
  LANGUAGE: "no",
  VISIBILITY: "public",
  BASE_HASHTAGS: "Vestlandet nyhende",
  NOINDEX_POLICY: "skip",
  SKIP_HEADING_PATTERN: DEFAULT_SKIP_HEADING_PATTERN,
  SANITY_PROJECT_ID: "6bxsir9v",
  SANITY_DATASET: "production",
  SANITY_API_VERSION: "v2021-10-21",
  SOURCE_ORIGIN: "https://www.vestlendingen.no",
  SOURCE_SITEMAP: "https://www.vestlendingen.no/articles/sitemap/0.xml",
  POLL_INTERVAL_MINUTES: "15",
  MAX_POSTS_PER_CYCLE: "5",
  POST_SPACING_SECONDS: "20",
  MAX_ARTICLE_AGE_HOURS: "72",
  DRY_RUN: "0",
  BACKFILL: "0",
  DATA_DIR: "/app/data",
  PUBLIC_BASE_URL: "https://mastobots.skvip.lol",
};

class ConfigError extends Error {}

/** Uppercase, underscore-separated form of a bot slug: `vestlendingen` -> `VESTLENDINGEN`. */
function envPrefix(slug) {
  return String(slug).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function readRaw(env, prefix, name) {
  const prefixed = prefix ? env[`${prefix}_${name}`] : undefined;
  const value = prefixed !== undefined && prefixed !== "" ? prefixed : env[name];
  if (value !== undefined && value !== "") return value;
  return DEFAULTS[name];
}

function readInt(env, prefix, name) {
  const raw = readRaw(env, prefix, name);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConfigError(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function readBool(env, prefix, name) {
  const raw = String(readRaw(env, prefix, name)).toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

/**
 * Build the resolved config for one bot descriptor.
 *
 * Throws rather than degrading: a bad regex or an unknown noindex policy is a
 * deployment mistake, and a robot that starts up having silently dropped a
 * filter is worse than one that refuses to start.
 */
function botConfig(bot, env = process.env) {
  const prefix = envPrefix(bot.slug);
  const read = (name) => readRaw(env, prefix, name);

  const noindexPolicy = String(read("NOINDEX_POLICY")).toLowerCase();
  if (!NOINDEX_POLICIES.has(noindexPolicy)) {
    throw new ConfigError(
      `${prefix}_NOINDEX_POLICY must be one of ${[...NOINDEX_POLICIES].join(", ")}, ` +
        `got ${JSON.stringify(noindexPolicy)}`,
    );
  }

  const patternSource = read("SKIP_HEADING_PATTERN");
  let skipHeadingPattern = null;
  if (patternSource) {
    try {
      skipHeadingPattern = new RegExp(patternSource, "iu");
    } catch (err) {
      throw new ConfigError(`${prefix}_SKIP_HEADING_PATTERN is not a valid regex: ${err.message}`);
    }
  }

  return {
    slug: bot.slug,
    prefix,
    mastodonBaseUrl: String(read("MASTODON_BASE_URL")).replace(/\/+$/, ""),
    // Prefix-only on purpose — see the module note.
    token: env[`${prefix}_MASTODON_TOKEN`] || "",
    language: read("LANGUAGE"),
    visibility: read("VISIBILITY"),
    baseHashtags: String(read("BASE_HASHTAGS")).split(/[\s,]+/).filter(Boolean),
    noindexPolicy,
    skipHeadingPattern,
    sanity: {
      projectId: read("SANITY_PROJECT_ID"),
      dataset: read("SANITY_DATASET"),
      apiVersion: read("SANITY_API_VERSION"),
    },
    sourceOrigin: String(read("SOURCE_ORIGIN")).replace(/\/+$/, ""),
    sourceSitemap: read("SOURCE_SITEMAP"),
    pollIntervalMinutes: readInt(env, prefix, "POLL_INTERVAL_MINUTES"),
    maxPostsPerCycle: readInt(env, prefix, "MAX_POSTS_PER_CYCLE"),
    postSpacingSeconds: readInt(env, prefix, "POST_SPACING_SECONDS"),
    maxArticleAgeHours: readInt(env, prefix, "MAX_ARTICLE_AGE_HOURS"),
    dryRun: readBool(env, prefix, "DRY_RUN"),
    backfill: readBool(env, prefix, "BACKFILL"),
  };
}

/** House-level settings, shared by every bot. */
function serviceConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8080),
    dataDir: readRaw(env, null, "DATA_DIR"),
    publicBaseUrl: String(readRaw(env, null, "PUBLIC_BASE_URL")).replace(/\/+$/, ""),
    dryRun: readBool(env, null, "DRY_RUN"),
  };
}

/**
 * A robot with no token cannot post. Refuse at boot rather than discovering it
 * on the first cycle, unless we are deliberately not posting anyway.
 */
function assertPostable(config) {
  if (!config.dryRun && !config.token) {
    throw new ConfigError(
      `${config.prefix}_MASTODON_TOKEN is unset — set it, or run with DRY_RUN=1`,
    );
  }
}

module.exports = {
  botConfig,
  serviceConfig,
  assertPostable,
  envPrefix,
  ConfigError,
  DEFAULTS,
};
