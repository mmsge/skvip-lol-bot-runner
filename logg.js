/**
 * Structured logging for the naustet box — copy this file into any service.
 *
 * One JSON object per line on stdout, in the shape `docs/logging-convention.md`
 * defines. The central `logg` service reads every container's stdout through the
 * read-only socket proxies, so a service needs no credentials, no network call
 * and no knowledge that `logg` exists — it just has to write the right lines.
 *
 * Dependency-free on purpose: node builtins only, so it drops into an Express,
 * Hono or Next service without touching package.json.
 *
 * CommonJS, like the rest of this skeleton. The named exports are statically
 * analysable, so an ESM/TypeScript service can still do
 * `import { logg } from "./logg.js"`.
 *
 *   const { logg, requestId, timer } = require("./logg");
 *
 *   logg.info("job.run.finished", { dur_ms: 812, extra: { rows: 4103 } });
 *   logg.error("db.query.failed", { err, route: "/gig/:id", status: 500 });
 *
 * The one rule that outranks the rest: **a log line describes what the software
 * did, never who it did it to.** `msg` and `event` must be static strings —
 * never a template literal carrying a value. See docs/logging-convention.md for
 * the full "never log" list.
 */
const { randomBytes } = require("node:crypto");

// The service's slug, exactly as in the registry in naustet-server/AGENTS.md.
// `logg` attributes lines to a service by container name anyway, but carrying it
// in the line means a mis-named container is visible rather than silently merged.
const SVC = process.env.LOGG_SVC || process.env.SERVICE_SLUG || "mastobots";

const LEVELS = ["debug", "info", "warn", "error", "fatal"];
const MIN_LEVEL = (process.env.LOGG_LEVEL || "info").toLowerCase();

// Stack traces are capped because a trace is unbounded and, in some runtimes,
// carries argument values — i.e. whatever a user typed. Frames are kept as
// location only; anything that looks like a value payload is dropped.
const MAX_STACK_FRAMES = 12;
const MAX_FIELD_CHARS = 2000;

// Fields the convention defines. Anything else is dropped here rather than at
// ingest, so a typo shows up in development instead of vanishing in production.
const ALLOWED = new Set([
  "route", "method", "status", "dur_ms", "req_id", "extra",
]);

// Guard patterns. With LOGG_STRICT=1 a match throws, so a leak is caught in a
// test rather than by the central redactor in production. `logg` redacts these at
// ingest either way, and counts every hit against the service — see
// logs.msge.no/etterleving.
// Two shapes for credentials, because they hide differently: a labelled value
// (`token=…`, `Authorization: …`) and a bare auth scheme (`Bearer abc123`). The
// first pattern alone missed "Authorization: Bearer abc" — the colon follows the
// header name, not the scheme.
const FORBIDDEN = [
  ["e-post address", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["credential", /\b(authorization|token|api[_-]?key|apikey|password|passwd|secret|credential)\b\s*[:=]/i],
  ["auth scheme", /\b(bearer|basic)\s+[\w.\-+/=]{3,}/i],
  ["JWT", /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/],
  ["IP address", /\b\d{1,3}(?:\.\d{1,3}){3}\b/],
  ["query string", /\?[\w%.-]+=/],
];

const STRICT = ["1", "true", "yes"].includes(process.env.LOGG_STRICT || "");

/**
 * A random per-request id, for correlating one request's lines.
 *
 * Random, never derived from a session, a user id or an address: a stable
 * per-person identifier is a tracking identifier however it is spelled.
 */
function requestId() {
  return randomBytes(4).toString("hex");
}

function clip(s, limit = MAX_FIELD_CHARS) {
  s = String(s);
  return s.length <= limit ? s : s.slice(0, limit) + "…";
}

/**
 * Frames only — location per frame, newest first, capped.
 *
 * V8's `err.stack` is a single string whose frames can carry constructor
 * arguments and object reprs, so each frame is reduced to the parenthesised
 * location (or the bare frame text when there is none).
 */
function stackFrames(err) {
  const raw = typeof err.stack === "string" ? err.stack : "";
  return raw
    .split("\n")
    .slice(1) // line 0 is "Type: message", already captured in err.msg
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => {
      const m = line.match(/\(([^()]+)\)\s*$/);
      return (m ? m[1] : line.replace(/^\s*at\s+/, "")).trim();
    })
    .filter(Boolean)
    .join(" < ");
}

function check(line) {
  if (!STRICT) return;
  const blob = JSON.stringify(line);
  for (const [label, pattern] of FORBIDDEN) {
    if (pattern.test(blob)) {
      throw new Error(
        `log line contains what looks like a(n) ${label}; see ` +
          "docs/logging-convention.md. Log the route pattern and a static " +
          "message, not the value.",
      );
    }
  }
}

function emit(level, event, fields) {
  fields = fields || {};
  const floor = LEVELS.includes(MIN_LEVEL) ? MIN_LEVEL : "info";
  if (LEVELS.indexOf(level) < LEVELS.indexOf(floor)) return;

  const line = {
    ts: new Date().toISOString(),
    level,
    svc: SVC,
    event,
  };
  if (fields.msg) line.msg = clip(fields.msg, 500);

  const err = fields.err;
  if (err instanceof Error) {
    line.err = { type: err.name, msg: clip(err.message, 500), stack: stackFrames(err) };
  } else if (err && typeof err === "object") {
    line.err = {};
    for (const k of ["type", "msg", "stack"]) {
      if (err[k] != null) line.err[k] = clip(err[k], 500);
    }
  }

  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED.has(k) && v != null) line[k] = v;
  }

  check(line);
  // One write per line: the container runtime is the transport, and a
  // half-written line is an unparseable line.
  process.stdout.write(JSON.stringify(line) + "\n");
}

const logg = {
  debug: (event, fields) => emit("debug", event, fields),
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields),
  fatal: (event, fields) => emit("fatal", event, fields),
};

/**
 * Measure an async operation and log it once, with the duration.
 *
 *   const rows = await timer("db.query", { route: "/gig/:id" }, () => query());
 *
 * A rejection is logged as `<event>.failed` at error level and re-thrown.
 */
async function timer(event, fields, fn) {
  const t0 = process.hrtime.bigint();
  const ms = () => Number((process.hrtime.bigint() - t0) / 1000000n);
  try {
    const out = await fn();
    logg.info(event, Object.assign({}, fields, { dur_ms: ms() }));
    return out;
  } catch (err) {
    logg.error(`${event}.failed`, Object.assign({}, fields, { err, dur_ms: ms() }));
    throw err;
  }
}

/**
 * Express request logger emitting one `http.request` event per response.
 *
 * This is the anti-footgun that matters most. `morgan` and every other access
 * logger record `req.url` — the CONCRETE path, with ids and query strings in it —
 * which breaks the convention on every request. This records `req.route.path`,
 * the MATCHED pattern (`/bok/:id`), and nothing else about the request.
 *
 *   app.use(logg.middleware());
 *
 * `req.route` is only populated once a route has matched, so an unmatched request
 * logs `route: "(unmatched)"` rather than leaking the path someone probed with.
 */
function middleware() {
  return function loggMiddleware(req, res, next) {
    const t0 = process.hrtime.bigint();
    req.reqId = requestId();
    res.on("finish", () => {
      logg.info("http.request", {
        route: (req.route && req.route.path) || "(unmatched)",
        method: req.method,
        status: res.statusCode,
        dur_ms: Number((process.hrtime.bigint() - t0) / 1000000n),
        req_id: req.reqId,
      });
    });
    next();
  };
}

/**
 * Hono equivalent: `app.use(honoMiddleware())`. `c.req.routePath` is Hono's
 * matched pattern, the same idea as Express's `req.route.path`.
 */
function honoMiddleware() {
  return async function loggHono(c, next) {
    const t0 = process.hrtime.bigint();
    await next();
    logg.info("http.request", {
      route: c.req.routePath || "(unmatched)",
      method: c.req.method,
      status: c.res.status,
      dur_ms: Number((process.hrtime.bigint() - t0) / 1000000n),
    });
  };
}

/**
 * Self-test: `node logg.js`.
 *
 * logg/tests/test_convention_parity.py runs this and the Python equivalent and
 * asserts the two vocabularies are identical, so the implementations cannot
 * drift.
 */
function selftest() {
  for (const lvl of LEVELS) emit(lvl, "selftest.level", { msg: `level ${lvl}` });
  logg.info("selftest.http", {
    msg: "served", route: "/bok/:id", method: "GET",
    status: 200, dur_ms: 12, req_id: requestId(), extra: { n: 1 },
  });
  try {
    throw new RangeError("selftest failure");
  } catch (err) {
    logg.error("selftest.error", { msg: "it broke", err });
  }
  const fields = [...ALLOWED, "ts", "level", "svc", "event", "msg", "err"].sort();
  process.stdout.write(
    JSON.stringify({ err_fields: ["type", "msg", "stack"], fields, levels: LEVELS }) + "\n",
  );
}

module.exports = { logg, requestId, timer, middleware, honoMiddleware };

if (require.main === module) selftest();
