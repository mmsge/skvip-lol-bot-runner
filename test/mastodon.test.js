// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MastodonClient,
  MastodonError,
  idempotencyKey,
  withBackoff,
  RETRYABLE,
} = require("../lib/mastodon");

const ok = (body = { id: "1", url: "https://skvip.lol/@bot/1" }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function client(fetchImpl) {
  return new MastodonClient({ baseUrl: "https://skvip.lol/", token: "tok", fetchImpl });
}

test("the idempotency key is stable for an article, and differs per bot", () => {
  assert.equal(idempotencyKey("vestlendingen", "abc"), idempotencyKey("vestlendingen", "abc"));
  assert.notEqual(idempotencyKey("vestlendingen", "abc"), idempotencyKey("annan", "abc"));
  assert.notEqual(idempotencyKey("vestlendingen", "abc"), idempotencyKey("vestlendingen", "abd"));
});

test("the idempotency key carries no readable upstream identifier", () => {
  const key = idempotencyKey("vestlendingen", "675480b2-54e4-4e7f-9076-f059a824aef6");
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.ok(!key.includes("675480b2"));
});

test("posts to /api/v1/statuses with the token and the idempotency header", async () => {
  let seen;
  const c = client(async (url, init) => {
    seen = { url, init };
    return ok();
  });
  const res = await c.postStatus({
    status: "hei",
    language: "no",
    visibility: "public",
    idempotencyKey: "key-1",
  });

  assert.equal(seen.url, "https://skvip.lol/api/v1/statuses");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, "Bearer tok");
  assert.equal(seen.init.headers["idempotency-key"], "key-1");
  assert.deepEqual(JSON.parse(seen.init.body), {
    status: "hei",
    language: "no",
    visibility: "public",
  });
  assert.deepEqual(res, { id: "1", url: "https://skvip.lol/@bot/1" });
});

test("classifies which failures are worth retrying", () => {
  assert.equal(RETRYABLE(429), true);
  assert.equal(RETRYABLE(500), true);
  assert.equal(RETRYABLE(503), true);
  assert.equal(RETRYABLE(401), false, "a bad token is not fixed by trying again");
  assert.equal(RETRYABLE(403), false);
  assert.equal(RETRYABLE(422), false, "an unpostable status stays unpostable");
});

test("a 401 is not retried", async () => {
  let calls = 0;
  const c = client(async () => {
    calls += 1;
    return new Response("nope", { status: 401 });
  });
  await assert.rejects(
    () => withBackoff(() => c.postStatus({ status: "hei" }), { sleep: async () => {} }),
    (err) => err instanceof MastodonError && err.status === 401 && !err.retryable,
  );
  assert.equal(calls, 1);
});

test("a 429 is retried and can succeed", async () => {
  let calls = 0;
  const c = client(async () => {
    calls += 1;
    return calls < 3 ? new Response("slow down", { status: 429 }) : ok();
  });
  const res = await withBackoff(() => c.postStatus({ status: "hei" }), { sleep: async () => {} });
  assert.equal(calls, 3);
  assert.equal(res.id, "1");
});

test("backoff gives up after the configured attempts", async () => {
  let calls = 0;
  const c = client(async () => {
    calls += 1;
    return new Response("boom", { status: 500 });
  });
  await assert.rejects(() =>
    withBackoff(() => c.postStatus({ status: "hei" }), { attempts: 3, sleep: async () => {} }),
  );
  assert.equal(calls, 3);
});

test("backoff waits longer each time", async () => {
  const waits = [];
  const c = client(async () => new Response("boom", { status: 500 }));
  await assert.rejects(() =>
    withBackoff(() => c.postStatus({ status: "hei" }), {
      attempts: 4,
      baseMs: 1000,
      sleep: async (ms) => waits.push(ms),
    }),
  );
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test("a transport failure is treated as transient", async () => {
  const c = client(async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    () => c.postStatus({ status: "hei" }),
    (err) => err instanceof MastodonError && err.retryable === true,
  );
});

test("a timeout is retryable and names the budget", async () => {
  const c = new MastodonClient({
    baseUrl: "https://skvip.lol",
    token: "tok",
    timeoutMs: 5,
    fetchImpl: (url, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        }),
      ),
  });
  await assert.rejects(
    () => c.postStatus({ status: "hei" }),
    (err) => err.retryable === true && /timed out/.test(err.message),
  );
});
