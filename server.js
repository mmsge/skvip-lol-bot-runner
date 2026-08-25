// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * mastobots — the HTTP surface and the scheduler bootstrap.
 *
 * The robots do their work on a timer; this is the window into it. One index of
 * the robots living here, one status page each, and the RSS feed the paper does
 * not publish for itself.
 *
 * Two box conventions are load-bearing in here and easy to undo by accident:
 *
 *   - the pages carry git-derived created/modified metadata, but NOT an HTTP
 *     `Last-Modified` header. They render live cycle state, and a git-derived
 *     validator on a live page would let caches revalidate stale content
 *     (naustet-server ADR 0015). The static files keep theirs.
 *   - there is no access logger. One `http.request` event per response carries
 *     the matched ROUTE PATTERN — `/:bot/`, never `/vestlendingen/`.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { logg } = require("./logg");
const { load } = require("./lib/registry");
const { serviceConfig } = require("./lib/config");
const { Store } = require("./lib/store");
const { runCycle, schedule } = require("./lib/poller");
const { renderFeed } = require("./lib/feed");

const service = serviceConfig();

// Site created/modified from git history, written by
// scripts/generate-page-dates.sh at deploy — the image has no .git, so the file
// is generated on the checkout and COPY'd in. Boot-time fallback when absent.
const BOOT_ISO = new Date().toISOString();
const DATES = (() => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, "page-dates.json"), "utf8"));
    return { created: d.created || BOOT_ISO, modified: d.modified || BOOT_ISO };
  } catch {
    return { created: BOOT_ISO, modified: BOOT_ISO };
  }
})();

const ROBOTS = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "robots.txt"), "utf8");
  } catch {
    return null;
  }
})();

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Shared <head>: page dates, Open Graph, canonical, and the feed link. */
function head({ title, description, canonical, feed }) {
  return `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta name="date" content="${DATES.created}">
  <meta name="last-modified" content="${DATES.modified}">
  <meta property="article:published_time" content="${DATES.created}">
  <meta property="article:modified_time" content="${DATES.modified}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta name="twitter:card" content="summary">
${feed ? `  <link rel="alternate" type="application/rss+xml" title="${esc(feed.title)}" href="${esc(feed.href)}">\n` : ""}  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.6 system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.2rem; }
    h1, h2 { line-height: 1.25; }
    a { color: inherit; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1.2rem; }
    dt { font-weight: 600; }
    dd { margin: 0; }
    .bot { border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent); padding-top: 1rem; margin-top: 2rem; }
    .muted { opacity: .7; }
    code { font-size: .9em; }
  </style>`;
}

function jsonLd(node) {
  return `  <script type="application/ld+json">${JSON.stringify(node).replace(/</g, "\\u003c")}</script>`;
}

function cycleLine(store) {
  const c = store.lastCycle;
  if (!c) return "no cycle has run yet";
  if (c.error) return `${esc(c.at)} — ${esc(c.error)}`;
  const reasons = Object.entries(c.reasons || {})
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return (
    `${esc(c.at)} via <code>${esc(c.source)}</code> — ` +
    `${c.fetched} read, ${c.posted} posted, ${c.held} held` +
    (reasons ? ` (${esc(reasons)})` : "") +
    (c.dryRun ? " · <strong>dry run</strong>" : "")
  );
}

function renderIndex(entries) {
  const canonical = `${service.publicBaseUrl}/`;
  const description =
    "Ein heim for Mastodon-robotar. Kvar robot les ei kjelde og legg ut nye saker.";
  const bots = entries
    .map(
      ({ bot, store }) => `  <section class="bot">
    <h2><a href="/${esc(bot.slug)}/">${esc(bot.title)}</a></h2>
    <p>${esc(bot.summary || "")}</p>
    <dl>
      <dt>Konto</dt><dd><code>${esc(bot.account)}</code></dd>
      <dt>Kjelde</dt><dd><a href="${esc(bot.publisher.homepage)}">${esc(bot.publisher.name)}</a></dd>
      <dt>Siste runde</dt><dd>${cycleLine(store)}</dd>
      <dt>Straum</dt><dd><a href="/${esc(bot.slug)}/rss.xml">RSS</a></dd>
    </dl>
  </section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="nn">
<head>
${head({ title: "mastobots", description, canonical })}
${jsonLd({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "mastobots",
  url: canonical,
  description,
  dateCreated: DATES.created,
  datePublished: DATES.created,
  dateModified: DATES.modified,
})}
</head>
<body>
  <h1>mastobots</h1>
  <p>${esc(description)}</p>
${bots}
  <p class="muted">Køyrer på <a href="https://msge.no">msge.no</a>-boksen.
  Laga med KI — <a href="https://msge.no/ki">om det</a>.</p>
</body>
</html>
`;
}

function renderBotPage({ bot, config, store }) {
  const canonical = `${service.publicBaseUrl}/${bot.slug}/`;
  const feedHref = `${canonical}rss.xml`;
  const description = bot.summary || bot.title;
  const items = store.recent.slice(0, 20);

  return `<!DOCTYPE html>
<html lang="nn">
<head>
${head({
  title: `${bot.title} — mastobots`,
  description,
  canonical,
  feed: { title: bot.title, href: feedHref },
})}
${jsonLd({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: bot.title,
  url: canonical,
  description,
  dateCreated: DATES.created,
  datePublished: DATES.created,
  dateModified: DATES.modified,
})}
</head>
<body>
  <p class="muted"><a href="/">&larr; mastobots</a></p>
  <h1>${esc(bot.title)}</h1>
  <p>${esc(description)}</p>
  <dl>
    <dt>Konto</dt><dd><code>${esc(bot.account)}</code></dd>
    <dt>Kjelde</dt><dd><a href="${esc(bot.publisher.homepage)}">${esc(bot.publisher.name)}</a></dd>
    <dt>Siste runde</dt><dd>${cycleLine(store)}</dd>
    <dt>Intervall</dt><dd>kvart ${config.pollIntervalMinutes}. minutt</dd>
    <dt>noindex</dt><dd><code>${esc(config.noindexPolicy)}</code>${
      store.deferredArticles ? ` — ${store.deferredArticles} sak(er) på vent` : ""
    }</dd>
    <dt>Kjende saker</dt><dd>${store.seenArticles}</dd>
    <dt>Straum</dt><dd><a href="rss.xml">RSS</a></dd>
  </dl>
  <h2>Siste saker</h2>
  <ul>
${items
  .map(
    (item) =>
      `    <li><a href="${esc(item.link)}">${esc(item.title)}</a> <span class="muted">${esc(
        (item.publishedAt || "").slice(0, 10),
      )}</span></li>`,
  )
  .join("\n")}
  </ul>
  <p class="muted">Uoffisiell robot. Ikkje tilknytt ${esc(bot.publisher.name)}.</p>
</body>
</html>
`;
}

/**
 * The sitemap is generated rather than served from a file, because the page set
 * is the registry: adding a robot adds a page, and a hand-maintained sitemap
 * would silently fall behind it.
 */
function renderSitemap(entries) {
  const urls = [
    `${service.publicBaseUrl}/`,
    ...entries.map(({ bot }) => `${service.publicBaseUrl}/${bot.slug}/`),
  ];
  const body = urls
    .map((loc) => `  <url>\n    <loc>${esc(loc)}</loc>\n    <lastmod>${DATES.modified}</lastmod>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** An agent-facing map of the service, per the box's discoverability rules. */
function renderLlms(entries) {
  return `# mastobots

> A house for Mastodon robots on the naustet box. Each robot reads a source and
> posts new articles to a Mastodon account on skvip.lol.

## Robots

${entries
  .map(
    ({ bot }) =>
      `- [${bot.title}](${service.publicBaseUrl}/${bot.slug}/) — posts as \`${bot.account}\`, ` +
      `reads ${bot.publisher.name} (${bot.publisher.homepage}). ` +
      `Feed: ${service.publicBaseUrl}/${bot.slug}/rss.xml`,
  )
  .join("\n")}

## Notes

- The robots are unofficial and unaffiliated with the publications they read.
- Each feed carries what its robot posts, which excludes articles the publisher
  marked \`robots.noindex\`.
`;
}

function send(res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, { "content-type": type, ...extraHeaders });
  res.end(body);
}

function buildServer(entries) {
  const bySlug = new Map(entries.map((e) => [e.bot.slug, e]));

  return http.createServer((req, res) => {
    const t0 = process.hrtime.bigint();
    res.on("finish", () =>
      logg.info("http.request", {
        route: res.loggRoute || "(unmatched)",
        method: req.method,
        status: res.statusCode,
        dur_ms: Number((process.hrtime.bigint() - t0) / 1000000n),
      }),
    );

    // Path only: a query string must never reach the log, and nothing here
    // takes one.
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/healthz") {
      res.loggRoute = "/healthz";
      return send(res, 200, "text/plain", "ok");
    }
    if (pathname === "/robots.txt" && ROBOTS !== null) {
      res.loggRoute = "/robots.txt";
      return send(res, 200, "text/plain; charset=utf-8", ROBOTS);
    }
    if (pathname === "/sitemap.xml") {
      res.loggRoute = "/sitemap.xml";
      return send(res, 200, "application/xml; charset=utf-8", renderSitemap(entries));
    }
    if (pathname === "/llms.txt") {
      res.loggRoute = "/llms.txt";
      return send(res, 200, "text/plain; charset=utf-8", renderLlms(entries));
    }
    if (pathname === "/") {
      res.loggRoute = "/";
      // No Last-Modified: this page renders live cycle state.
      return send(res, 200, "text/html; charset=utf-8", renderIndex(entries));
    }

    const feedMatch = pathname.match(/^\/([a-z0-9-]+)\/rss\.xml$/);
    if (feedMatch && bySlug.has(feedMatch[1])) {
      const entry = bySlug.get(feedMatch[1]);
      res.loggRoute = "/:bot/rss.xml";
      const base = `${service.publicBaseUrl}/${entry.bot.slug}/`;
      return send(
        res,
        200,
        "application/rss+xml; charset=utf-8",
        renderFeed({
          bot: entry.bot,
          items: entry.store.recent,
          selfUrl: `${base}rss.xml`,
          siteUrl: base,
          language: entry.config.language,
          updatedAt: entry.store.lastCycle && entry.store.lastCycle.at,
        }),
      );
    }

    const botMatch = pathname.match(/^\/([a-z0-9-]+)\/?$/);
    if (botMatch && bySlug.has(botMatch[1])) {
      res.loggRoute = "/:bot/";
      if (!pathname.endsWith("/")) {
        res.writeHead(301, { location: `${pathname}/` });
        return res.end();
      }
      return send(res, 200, "text/html; charset=utf-8", renderBotPage(bySlug.get(botMatch[1])));
    }

    res.loggRoute = "(unmatched)";
    return send(res, 404, "text/plain; charset=utf-8", "not found\n");
  });
}

async function main() {
  const bots = load(process.env, { requirePostable: !service.dryRun });

  const entries = [];
  for (const { bot, config } of bots) {
    const store = await new Store(service.dataDir, bot.slug).load();
    entries.push({ bot, config, store });
  }

  const server = buildServer(entries);
  server.listen(service.port, "0.0.0.0", () =>
    logg.info("service.started", {
      extra: { port: service.port, bots: entries.map((e) => e.bot.slug) },
    }),
  );

  // Each robot runs on its own chain, so a slow cycle for one cannot delay
  // another's.
  for (const entry of entries) {
    schedule(
      () =>
        runCycle(entry.bot, entry.config, entry.store, {
          publicBaseUrl: service.publicBaseUrl,
        }),
      entry.config.pollIntervalMinutes,
    );
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
    // Don't hang on a keep-alive connection if something is holding one open.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    logg.fatal("service.start.failed", { err });
    process.exit(1);
  });
}

module.exports = { buildServer, renderIndex, renderBotPage, renderSitemap, renderLlms };
