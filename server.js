// SPDX-License-Identifier: AGPL-3.0-or-later
// Minimal zero-dependency starter so the skeleton builds, boots and passes
// `make verify` out of the box. Replace with the real service — but keep the
// conventions it demonstrates: an unauthenticated /healthz, and the
// git-derived creation/modification metadata every site on the box carries
// (hetzner-server ADR 0015 / msge-no ADR 0004).
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = process.env.PORT || 8080;

// Site created/modified from git history, written by
// scripts/generate-page-dates.sh at deploy — the image has no .git, so the
// file is generated on the checkout and COPY'd in. Boot-time fallback when
// absent (e.g. a bare `docker build` that skipped the script).
const BOOT_ISO = new Date().toISOString();
const DATES = (() => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, "page-dates.json"), "utf8"));
    return { created: d.created || BOOT_ISO, modified: d.modified || BOOT_ISO };
  } catch {
    return { created: BOOT_ISO, modified: BOOT_ISO };
  }
})();

const PAGE = `<!DOCTYPE html>
<html lang="nn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="date" content="${DATES.created}">
  <meta name="last-modified" content="${DATES.modified}">
  <meta property="article:published_time" content="${DATES.created}">
  <meta property="article:modified_time" content="${DATES.modified}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"__SLUG__","url":"https://__SLUG__.msge.no/","dateCreated":"${DATES.created}","datePublished":"${DATES.created}","dateModified":"${DATES.modified}"}</script>
  <title>__SLUG__</title>
</head>
<body>
  <h1>__SLUG__</h1>
  <p>__SLUG__ is running.</p>
</body>
</html>
`;
const LAST_MODIFIED = new Date(DATES.modified).toUTCString();

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    // The starter page is static, so a git-derived Last-Modified (+ 304) is
    // truthful. DROP the header if this page ever renders DB/live data — a git
    // validator would let caches revalidate stale content.
    const ims = Date.parse(req.headers["if-modified-since"] || "");
    if (!Number.isNaN(ims) && ims >= Date.parse(LAST_MODIFIED)) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Last-Modified": LAST_MODIFIED,
    });
    res.end(PAGE);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`__SLUG__ listening on :${PORT}`));
