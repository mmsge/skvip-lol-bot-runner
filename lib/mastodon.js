// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Mastodon side: one POST per article.
 *
 * The robot posts as a real Mastodon account on skvip.lol rather than as a
 * hand-rolled ActivityPub actor. Registering the account gets the exact
 * `@botlendingen@skvip.lol` handle plus followers, replies, boosts,
 * search, moderation and account migration for free; a native actor would mean
 * webfinger, HTTP signatures, an inbox, a follower store and delivery retries,
 * and still could not hold that handle, because skvip.lol's webfinger belongs to
 * Mastodon (ADR 0001).
 *
 * The token needs `write:statuses` and nothing else. No media is ever uploaded —
 * the article photo reaches the timeline through Mastodon's own link preview
 * card, and uploading it as well would show the same photograph twice — so
 * `write:media` is deliberately not requested.
 */
const { createHash } = require("node:crypto");
const { DEFAULT_TIMEOUT_MS } = require("./http");

// 429 and 5xx are worth another go; a 401/403/422 is a configuration problem
// that retrying only turns into rate-limiting.
const RETRYABLE = (status) => status === 429 || (status >= 500 && status < 600);

/**
 * A stable idempotency key for one article on one account.
 *
 * Mastodon dedupes on this header, so a crash between "posted" and "persisted"
 * cannot produce a duplicate: the retry presents the same key and Mastodon
 * returns the status it already created. Derived from the article id (never the
 * URL or slug, which can be rewritten) and hashed so the key carries no readable
 * upstream identifier.
 */
function idempotencyKey(botSlug, articleId) {
  return createHash("sha256").update(`${botSlug} ${articleId}`).digest("hex").slice(0, 32);
}

class MastodonError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "MastodonError";
    this.status = status;
    this.retryable = retryable;
  }
}

class MastodonClient {
  constructor({ baseUrl, token, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Post one status.
   *
   * Returns { id, url } from the created status. Throws MastodonError with
   * `retryable` set, so the caller can decide between backing off and giving up
   * — an article that fails to post stays unseen and is retried next cycle.
   */
  async postStatus({ status, language, visibility, idempotencyKey: key }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/v1/statuses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          accept: "application/json",
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: JSON.stringify({ status, language, visibility }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new MastodonError(`mastodon returned ${res.status}`, {
          status: res.status,
          retryable: RETRYABLE(res.status),
        });
      }
      const body = await res.json();
      return { id: body.id, url: body.url };
    } catch (err) {
      if (err instanceof MastodonError) throw err;
      if (err.name === "AbortError") {
        throw new MastodonError(`mastodon timed out after ${this.timeoutMs}ms`, { retryable: true });
      }
      // A transport failure is almost always transient — DNS, a dropped
      // connection, the instance restarting.
      throw new MastodonError(`mastodon request failed: ${err.message}`, { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Run `fn`, retrying retryable failures with exponential backoff.
 *
 * Deliberately few attempts: the poller runs again in fifteen minutes, and the
 * article stays unseen until it posts, so giving up early costs a delay rather
 * than a post.
 */
async function withBackoff(
  fn,
  { attempts = 3, baseMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!err || !err.retryable || attempt === attempts - 1) throw err;
      await sleep(baseMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

module.exports = { MastodonClient, MastodonError, idempotencyKey, withBackoff, RETRYABLE };
