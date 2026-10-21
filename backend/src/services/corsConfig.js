// =========================================================================
// CORS policy, kept in one place so the security rule is reviewable and
// testable on its own.
//
// The rule it replaces trusted *every* subdomain: the origin callback ran
//   origin.endsWith('.nabin.in')
// alongside `credentials: true`. That is a wildcard wearing a suffix — a
// hostile or forgotten `anything.nabin.in` gets credentialed cross-origin
// access for as long as DNS for it exists. Exact matching against an explicit
// allowlist is the fix: an origin is allowed only if it is spelled, in full,
// in one of the two lists below, and nothing else can ever match it.
//
// A request with no `Origin` header is not a browser request — Flutter, curl,
// and server-to-server calls never send one. CORS is a browser-enforced
// contract, so refusing here would break exactly the clients that were never
// subject to it. We let them through with no `Access-Control-Allow-Origin`
// header (there is no origin to reflect) and leave authorization to the
// routes themselves. CORS is never the auth gate.
// =========================================================================

const cors = require('cors');
const { isProduction } = require('./RuntimeMode');

// Origins that reach the backend cross-origin only in development: the web
// apps run on their own Next/ports and hit http://localhost:4000/api. In
// production the same apps are served same-origin through the Vercel /api
// proxy, so they send no cross-origin request at all. Port 3004 is the
// restaurant merchant web app's dev origin.
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://localhost:4000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:3004',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173'
];

// The only origins a production deployment will ever honour. These are exact,
// complete origins — a scheme, a host, and (when present) a port, and nothing
// more. Adding one is a deliberate, reviewed line here, not a wildcard.
const PROD_ORIGINS = [
  'https://admin.nabin.in',
  'https://api.nabin.in',
  'https://api-beta.nabin.in',
  'https://beta.nabin.in',
  'https://nabin.in'
];

// An allowlist entry is only meaningful if it is a bare origin. A path, a
// trailing slash, a wildcard, or a missing scheme would either never match a
// browser Origin (silent breakage) or, worse, sneak a partial match back in.
function assertValidOrigin(origin, listName) {
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new Error(`CORS ${listName}: origin must be a non-empty string, got ${JSON.stringify(origin)}`);
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (err) {
    throw new Error(`CORS ${listName}: '${origin}' is not an absolute URL with a scheme`);
  }
  if (!parsed.protocol || !parsed.host) {
    throw new Error(`CORS ${listName}: '${origin}' must have both a scheme and a host`);
  }
  if (origin.includes('*')) {
    throw new Error(`CORS ${listName}: '${origin}' contains a wildcard — the allowlist is exact origins only`);
  }
  // A browser `Origin` header is scheme://host[:port] with no path, so anything
  // beyond the authority would match nothing.
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`CORS ${listName}: '${origin}' must be a bare origin (no path, query or fragment)`);
  }
  return origin;
}

function assertValidOriginList(origins, listName) {
  if (!Array.isArray(origins)) {
    throw new Error(`CORS ${listName} must be an array of exact origins`);
  }
  origins.forEach(o => assertValidOrigin(o, listName));
}

// Production is decided by NODE_ENV alone (via isProduction). When it is set,
// a missing or empty production allowlist is a hard boot failure rather than a
// silent fall back to `*` — a deploy that forgot its origins must not come up
// wide open. Outside production the dev origins are added on top of the prod
// list, because the in-code prod origins are also exercised by the suite and
// are harmless to honour on a local server.
function buildAllowedOrigins({ production = isProduction() } = {}) {
  assertValidOriginList(PROD_ORIGINS, 'PROD_ORIGINS');
  assertValidOriginList(DEV_ORIGINS, 'DEV_ORIGINS');

  if (production && PROD_ORIGINS.length === 0) {
    throw new Error(
      'CORS refuses to start in production with an empty PROD_ORIGINS allowlist. ' +
      'List the exact origins the deployment serves; never fall back to *.'
    );
  }
  const list = production ? PROD_ORIGINS : [...DEV_ORIGINS, ...PROD_ORIGINS];
  return new Set(list);
}

// Reflect the exact origin for an approved browser request, nothing at all for
// a disallowed one, and pass a no-Origin request through without a permissive
// header. Never returns `true`, which would echo whatever origin arrived.
function makeOriginChecker(allowedOrigins) {
  return function corsOrigin(origin, callback) {
    if (!origin) return callback(null, origin); // non-browser client: no ACAO to set
    if (allowedOrigins.has(origin)) return callback(null, origin); // exact match, reflected verbatim
    return callback(null, false); // refused: cors sets no ACAO and reflects nothing
  };
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

// If-Match and If-None-Match are conditions, not payload, and both are part of a
// contract this API already offers: a campaign save is refused unless it names the
// revision it edited, and the config feed answers 304 so a client can revalidate cheaply.
// A browser preflights either header, so leaving them out would break exactly the
// clients the contract was written for — the admin console and a web app on another
// origin — while Node and Flutter clients sail past it, which is why the test suite
// cannot see this.
//
// Idempotency-Key joins X-Idempotency-Key for the same reason and with the same blind
// spot: six routes read the canonical spelling FIRST (`req.headers['idempotency-key']
// || req.headers['x-idempotency-key']`) — ride and parcel booking, grocery checkout,
// offer acceptance, food ordering, coupon redemption — and the ledger and dispatch
// procedures deduplicate on the value it carries. A browser that honoured that contract
// preflighted a header this list did not allow, so the request never left the browser,
// and a retry after a dropped response could book the trip or redeem the coupon twice.
const ALLOWED_HEADERS = [
  'Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key',
  'X-Idempotency-Key', 'X-App-Version', 'X-Device-Id', 'If-Match', 'If-None-Match'
];

// Without this, `response.headers.get('ETag')` reads as null in a browser even though
// the server sent it, so a cross-origin client could never obtain the revision a
// conditional write or a conditional GET has to echo back.
const EXPOSED_HEADERS = ['ETag'];

function buildCorsOptions({ production = isProduction(), allowedOrigins } = {}) {
  const allowed = allowedOrigins || buildAllowedOrigins({ production });
  return {
    origin: makeOriginChecker(allowed),
    credentials: true,
    methods: METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS
  };
}

// The single mount used by server.js. Calling it at load time is the startup
// validation: buildAllowedOrigins throws on an invalid production allowlist, so
// a misconfigured deploy fails loudly on boot instead of serving a wide-open
// or silently-broken CORS policy.
function createCorsMiddleware(options = {}) {
  return cors(buildCorsOptions(options));
}

module.exports = {
  DEV_ORIGINS,
  PROD_ORIGINS,
  ALLOWED_HEADERS,
  EXPOSED_HEADERS,
  METHODS,
  assertValidOrigin,
  assertValidOriginList,
  buildAllowedOrigins,
  makeOriginChecker,
  buildCorsOptions,
  createCorsMiddleware
};
