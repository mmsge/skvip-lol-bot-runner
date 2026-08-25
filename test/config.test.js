// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require("node:test");
const assert = require("node:assert/strict");
const { botConfig, serviceConfig, assertPostable, envPrefix, ConfigError } = require("../lib/config");
const { validate, loadDescriptors, prepare, RegistryError } = require("../lib/registry");
const descriptor = require("../bots/vestlendingen");

const bot = { slug: "vestlendingen" };

test("derives the env prefix from the slug", () => {
  assert.equal(envPrefix("vestlendingen"), "VESTLENDINGEN");
  assert.equal(envPrefix("norske-tog"), "NORSKE_TOG");
});

test("falls back to the house default when the bot sets nothing", () => {
  const config = botConfig(bot, {});
  assert.equal(config.language, "no");
  assert.equal(config.visibility, "public");
  assert.equal(config.noindexPolicy, "skip");
  assert.deepEqual(config.baseHashtags, ["Vestlandet", "nyhende"]);
  assert.equal(config.pollIntervalMinutes, 15);
  assert.equal(config.maxPostsPerCycle, 5);
  assert.equal(config.maxArticleAgeHours, 72);
  assert.equal(config.sanity.projectId, "6bxsir9v");
});

test("an unprefixed variable is the house default for every bot", () => {
  assert.equal(botConfig(bot, { POLL_INTERVAL_MINUTES: "30" }).pollIntervalMinutes, 30);
});

test("a bot's own prefixed variable wins over the house default", () => {
  const config = botConfig(bot, {
    POLL_INTERVAL_MINUTES: "30",
    VESTLENDINGEN_POLL_INTERVAL_MINUTES: "5",
  });
  assert.equal(config.pollIntervalMinutes, 5);
});

test("an empty prefixed variable does not shadow the house default", () => {
  assert.equal(
    botConfig(bot, { POLL_INTERVAL_MINUTES: "30", VESTLENDINGEN_POLL_INTERVAL_MINUTES: "" })
      .pollIntervalMinutes,
    30,
  );
});

test("the token is prefix-only, never shared between bots", () => {
  // A fallback here would quietly post one bot's articles from another's account.
  assert.equal(botConfig(bot, { MASTODON_TOKEN: "shared" }).token, "");
  assert.equal(botConfig(bot, { VESTLENDINGEN_MASTODON_TOKEN: "mine" }).token, "mine");
});

test("base hashtags split on whitespace or commas", () => {
  assert.deepEqual(botConfig(bot, { BASE_HASHTAGS: "A B" }).baseHashtags, ["A", "B"]);
  assert.deepEqual(botConfig(bot, { BASE_HASHTAGS: "A, B ,C" }).baseHashtags, ["A", "B", "C"]);
});

test("boolean flags accept the usual spellings", () => {
  for (const value of ["1", "true", "yes", "on", "TRUE"]) {
    assert.equal(botConfig(bot, { DRY_RUN: value }).dryRun, true, value);
  }
  for (const value of ["0", "false", "no", ""]) {
    assert.equal(botConfig(bot, { DRY_RUN: value }).dryRun, false, value);
  }
});

test("rejects an unknown noindex policy rather than silently skipping", () => {
  assert.throws(
    () => botConfig(bot, { NOINDEX_POLICY: "maybe" }),
    (err) => err instanceof ConfigError && /NOINDEX_POLICY/.test(err.message),
  );
});

test("rejects a non-numeric interval", () => {
  assert.throws(() => botConfig(bot, { POLL_INTERVAL_MINUTES: "snart" }), ConfigError);
  assert.throws(() => botConfig(bot, { MAX_POSTS_PER_CYCLE: "-1" }), ConfigError);
});

test("rejects an invalid skip-heading regex rather than dropping the filter", () => {
  assert.throws(() => botConfig(bot, { SKIP_HEADING_PATTERN: "([" }), ConfigError);
});

test("an empty skip-heading pattern disables the daily-brief rule", () => {
  assert.equal(botConfig(bot, { SKIP_HEADING_PATTERN: " " }).skipHeadingPattern.source.length > 0, true);
});

test("refuses to start a postable bot with no token", () => {
  assert.throws(() => assertPostable(botConfig(bot, {})), ConfigError);
  assert.doesNotThrow(() => assertPostable(botConfig(bot, { DRY_RUN: "1" })));
  assert.doesNotThrow(() => assertPostable(botConfig(bot, { VESTLENDINGEN_MASTODON_TOKEN: "t" })));
});

test("service config trims a trailing slash off the public base URL", () => {
  assert.equal(
    serviceConfig({ PUBLIC_BASE_URL: "https://mastobots.skvip.lol/" }).publicBaseUrl,
    "https://mastobots.skvip.lol",
  );
});

// -------------------------------------------------------------- registry ----

test("the shipped descriptor is valid", () => {
  assert.doesNotThrow(() => validate(descriptor, "vestlendingen.js"));
});

test("rejects a descriptor missing what the house needs", () => {
  const good = { slug: "x", title: "X", account: "@x@skvip.lol", publisher: { name: "P" }, fetchLimit: 20 };
  assert.doesNotThrow(() => validate(good, "x.js"));
  for (const [field, value] of [
    ["slug", "Not A Slug"],
    ["title", ""],
    ["account", "x@skvip.lol"],
    ["publisher", null],
    ["fetchLimit", 0],
  ]) {
    assert.throws(
      () => validate({ ...good, [field]: value }, "x.js"),
      (err) => err instanceof RegistryError && err.message.includes(field),
      `${field} should be rejected`,
    );
  }
});

test("loads the bots directory", () => {
  const bots = loadDescriptors();
  assert.equal(bots.length, 1);
  assert.equal(bots[0].slug, "vestlendingen");
});

test("prepare assembles the composer options from descriptor and env", () => {
  const { bot: prepared } = prepare(descriptor, { VESTLENDINGEN_BASE_HASHTAGS: "Ein To" });
  assert.deepEqual(prepared.composer, {
    baseHashtags: ["Ein", "To"],
    maxCategories: 2,
    maxTags: 3,
  });
});
