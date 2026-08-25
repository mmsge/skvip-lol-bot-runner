// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one place this service talks to somebody else's server.
 *
 * Reading the paper's Sanity dataset is a courtesy relationship, not a
 * contract — it is a public dataset rather than a published interface, and it
 * can change or close without notice (ADR 0002). The manners live here: a
 * User-Agent that names the robot and how to reach its operator, a timeout so a
 * hanging upstream cannot wedge the cycle, and no retry loop of our own (the
 * poller decides that, once, with backoff).
 */

const DEFAULT_TIMEOUT_MS = 15000;

class HttpError extends Error {
  constructor(message, { status = 0, url = "" } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    // Kept for the caller's own use — never logged. A concrete URL in the
    // central log store is exactly what the logging convention forbids.
    this.url = url;
  }
}

/** The robot's calling card: who this is, and where to complain. */
function userAgent(botSlug, publicBaseUrl) {
  return `mastobots/1.0 (+${publicBaseUrl}/${botSlug}/)`;
}

async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: "*/*", ...headers },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new HttpError(`upstream returned ${res.status}`, { status: res.status, url });
    }
    return await res.text();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.name === "AbortError") {
      throw new HttpError(`upstream timed out after ${timeoutMs}ms`, { url });
    }
    throw new HttpError(`upstream request failed: ${err.message}`, { url });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  const body = await fetchText(url, options);
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new HttpError(`upstream returned unparseable JSON: ${err.message}`, { url });
  }
}

module.exports = { fetchText, fetchJson, userAgent, HttpError, DEFAULT_TIMEOUT_MS };
