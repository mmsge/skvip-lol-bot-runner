// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @linjeskift@skvip.lol — European rail news, picked by linjeskift.
 *
 * Unlike the other robot here, this one reads no website. linjeskift (a sibling
 * service on the box) ingests rail-news feeds, decides what is worth keeping and
 * writes its verdicts into a SQLite database; this robot reads that database and
 * toots each kept item, and does nothing else (ADR 0010). It generates no text:
 * a toot is the original English title, the feed's own snippet, the link and
 * hashtags. The hashtags are the only Nynorsk on it, being the category and
 * country labels below.
 *
 * Those account properties are set once by hand on skvip.lol: the bot flag, the
 * bio and a `write:statuses` token. **Keep `title`, `account` and `summary` in
 * step with the live account**, because the status page renders them.
 */
module.exports = {
  slug: "linjeskift",

  title: "Linjeskift 🤖",
  account: "@linjeskift@skvip.lol",
  summary:
    "Ein robot som legg ut europeiske jernbanenyhende som linjeskift har valt ut. " +
    "Overskriftene står på originalspråket, engelsk.",

  // Where the items come from. `linjeskift-db` reads the sibling's SQLite
  // database (`LINJESKIFT_DB_PATH`); the default, `sanity`, is the other robot's.
  source: "linjeskift-db",

  publisher: {
    name: "europeiske jernbanemedium",
    homepage: "https://skvip.lol/@linjeskift",
    // The retired Atom feed lived at linjeskift.msge.no. This house's own RSS
    // for the robot replaces it.
    hasFeed: false,
  },

  // Sits under the house's own defaults for language and hashtags, and under
  // any env var. English because the toots are; the base tag is used verbatim.
  defaults: {
    LANGUAGE: "en",
    BASE_HASHTAGS: "Linjeskift",
    BACKFILL: "1",
  },

  // Rows per cycle. The floor of relevance and the age window do the rest.
  fetchLimit: 50,

  // The category and the country each make one hashtag, and there are no tags.
  maxCategories: 2,
  maxTags: 0,

  // Nynorsk display labels, copied from linjeskift's render.py. linjeskift
  // stores codes (`night_train`, `DE`); the hashtags say what a reader says.
  labels: {
    category: {
      new_line: "Nytt samband",
      night_train: "Nattog",
      infrastructure: "Infrastruktur",
      network_change: "Nettendring",
      major_disruption: "Større avbrot",
      other: "Anna",
    },
    country: {
      EU: "Europa", Nordic: "Norden", International: "Internasjonalt",
      NO: "Noreg", SE: "Sverige", DK: "Danmark", FI: "Finland", IS: "Island",
      DE: "Tyskland", FR: "Frankrike", GB: "Storbritannia", UK: "Storbritannia",
      NL: "Nederland", BE: "Belgia", CH: "Sveits", AT: "Austerrike",
      IT: "Italia", ES: "Spania", PT: "Portugal", PL: "Polen",
      CZ: "Tsjekkia", SK: "Slovakia", HU: "Ungarn", SI: "Slovenia",
      HR: "Kroatia", RO: "Romania", BG: "Bulgaria", GR: "Hellas",
      EE: "Estland", LV: "Latvia", LT: "Litauen", IE: "Irland",
      LU: "Luxembourg", RS: "Serbia", UA: "Ukraina", TR: "Tyrkia",
    },
  },

  feed: {
    title: "Linjeskift (robot)",
    description:
      "Europeiske jernbanenyhende som linjeskift har valt ut, slik roboten ser dei. " +
      "Overskriftene står på engelsk.",
    language: "en",
  },
};
