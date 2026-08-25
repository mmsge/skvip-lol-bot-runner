# 0006 — Hashtags come from the publisher's own `name` field

**Status:** Accepted
**Contributors:** Claude (agent decision — no human input on the technical choice)
**Topics:** hashtags, nynorsk, i18n

## Context

An earlier revision of the plan carried a **transliteration table** mapping the
paper's categories and tags to hashtag spellings — the assumption being that the
dataset exposed slugs (`sjomat-og-havbruk`) and that turning those back into
readable, correctly accented Norwegian would need a lookup we maintained.

Probing removed the assumption. Category and tag documents carry a **`name`**
field with the publisher's own spelling: `Sjømat og havbruk`, `Ålesund`,
`Kommentar`.

## Decision

Derive hashtags by CamelCasing the `name` field. No table.

- Split on everything that is not a letter, digit or underscore — which is
  exactly what Mastodon accepts in a tag — and upper-case the first character of
  each word, leaving the rest as the paper wrote it.
- `Sjømat og havbruk` → `#SjømatOgHavbruk`. `Ålesund` → `#Ålesund`.
  `Heimekontor-forbod` → `#HeimekontorForbod`.
- **Base hashtags bypass this entirely** and are used verbatim, which is what
  keeps `#nyhende` lower case while every derived tag is capitalised.
- Deduplicate case-insensitively, because Mastodon treats `#Kommentar` and
  `#kommentar` as one tag and posting both renders as a repeated word.
- Drop a result Mastodon would reject: empty, punctuation-only, or all digits.

## Consequences

- **Accents are preserved, not stripped.** `#Ålesund` is the tag people actually
  use; `#Alesund` is a tag nobody follows.
- A category the paper invents next month works on the first cycle, with no
  change here. A table would have produced a wrong tag silently until someone
  noticed.
- The spelling is the paper's, including any inconsistency in it. That is the
  right trade: our job is to mirror their vocabulary, not to correct it.
- **Categories and tags are capped separately** — the category always makes the
  post, the tags are trimmed to three. Only one article on the corpus carries
  tags at all and it carries five; capping the two together would have let a
  tag-heavy article push its own section off the post. The cap is what produced
  `#Vestlandet #nyhende #Kommentar #Samferdsel #Haugesund #Stavanger` in the dry
  run, dropping `Bergen` and `Bompenger`.
