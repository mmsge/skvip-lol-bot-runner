// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @botlendingen@skvip.lol — new articles from vestlendingen.no.
 *
 * The whole robot is this file plus a block of `VESTLENDINGEN_` env vars. The
 * machinery in `lib/` knows nothing about this paper; everything specific to it
 * is either here or configurable.
 *
 * The robot republishes headlines from a paper it has no relationship with, so
 * the account is unmistakably a third-party robot rather than the paper's own
 * feed: the handle is `botlendingen` rather than the paper's name, the display
 * name carries 🤖, the bio says unofficial and unaffiliated and links to
 * vestlendingen.no as the source, and Mastodon's bot flag is set (which makes
 * the ActivityPub type `Service` and puts the robot badge on the profile). It
 * posts a heading, a short intro and a link — never the body, which it can read
 * and will not.
 *
 * Those are properties of the Mastodon account, set once by hand; they are
 * recorded here because they are part of the design and nothing else in the repo
 * would say so. **Keep them in step with the live account** — these strings are
 * rendered on the public index and status page, so a stale handle here
 * advertises an account that does not exist.
 */
module.exports = {
  slug: "vestlendingen",

  // How the robot presents itself on its own status page. Both mirror the live
  // Mastodon account exactly, because the status page links people to it.
  title: "Vestlendingen 🤖",
  account: "@botlendingen@skvip.lol",
  summary:
    "Ein uoffisiell robot som legg ut nye artiklar frå vestlendingen.no. " +
    "Ikkje tilknytt Vestlendingen eller Initiativ Media.",

  publisher: {
    name: "Vestlendingen",
    homepage: "https://www.vestlendingen.no",
    // Subrite Publish (Initiativ Media AS): Next.js on Vercel, Sanity behind it.
    // The paper has no RSS or Atom feed of its own — /rss, /feed, /atom.xml and
    // the rest are all absent — which is why this house serves one for it.
    hasFeed: false,
  },

  // One GROQ query returns this many articles per cycle. Twenty is comfortably
  // more than the paper publishes in a 72-hour window, so nothing new can slip
  // past the age filter between polls, and it is still one small request.
  fetchLimit: 20,

  // Composition caps. The category always makes the post; the tags are what get
  // trimmed. Only one article on the corpus carries tags at all, and it carries
  // five — capping the two together would let a tag-heavy article push its own
  // section off the post.
  maxCategories: 2,
  maxTags: 3,

  // The feed this house publishes on the paper's behalf.
  //
  // The feed title says "(robot)" in words rather than mirroring the account's
  // 🤖, deliberately: a feed reader shows no bot badge, no handle and no
  // profile, and cannot be relied on to render an emoji at all, so this is the
  // one surface where the word has to carry it on its own.
  feed: {
    title: "Vestlendingen (robot)",
    description:
      "Nye artiklar frå vestlendingen.no, slik roboten ser dei. " +
      "Uoffisiell, og ikkje tilknytt Vestlendingen eller Initiativ Media.",
    language: "no",
  },
};
