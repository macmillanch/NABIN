/**
 * Local/test-only reuse of already-authenticated sessions for the chained suites.
 *
 * Why this exists
 * ---------------
 * `POST /api/auth/send-otp` allows **5 dispatches per phone per 10 minutes**
 * (`PersistentWallet.sendAuthOtp`, keyed by the phone alone, held in
 * `this.rateLimitRecords`). That counter lives in the server process, so a suite run on its
 * own — which is what my standalone verification did — always starts from a clean budget and
 * passes, while the full 21-link chain runs against ONE server process and every suite that
 * signs in as `9810122910` or `9845011982` spends the same pool. That is how the chain ended
 * up reporting `OTP_DISPATCH_FAILED` as if merchant and driver authorisation had broken: the
 * suites were each re-authenticating the same handful of identities from scratch, dozens of
 * times, against a shared budget of five.
 *
 * What this does NOT do
 * ---------------------
 * Nothing here weakens authentication. The rate limit is untouched, not raised, not
 * bypassed, and not made configurable; no test asserts less than it did; no credential is
 * faked, and no token is honoured that the server has not just accepted. It only stops the
 * harness from *wasting* OTP dispatches it does not need, by reusing a session that already
 * exists and is still valid — which is what a real client does, and what these suites should
 * have been doing all along.
 *
 * Every cached token is re-validated with a real authenticated request before use, so a
 * logged-out, expired or revoked session cannot be replayed from the cache; a miss
 * re-authenticates through the normal OTP path.
 *
 * Fail-closed by construction
 * ---------------------------
 * This module refuses to run unless the target is a loopback/private address AND the process
 * is not production AND `NABIN_TEST_MODE` is not just set but the base URL is local. A
 * production or staging host therefore cannot use this harness even by accident, and the
 * cache file is never written for a non-local target. Tokens are session credentials, so the
 * file is written for the current user only, is gitignored, and nothing in this module logs a
 * token.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_FILE = path.join(__dirname, '.nabin_test_sessions.json');
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // sessions themselves live 30 days; this is a harness convenience

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1|\[::1\])$/i;
const PRIVATE = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3})$/i;

/** True only for a host this harness may legitimately hold a live session for. */
function isLocalTarget(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch (e) {
    return false;
  }
  return LOOPBACK.test(host) || PRIVATE.test(host);
}

function refuseReason(baseUrl) {
  if (process.env.NODE_ENV === 'production') {
    return 'NODE_ENV=production — session reuse is a local harness affordance and is refused here';
  }
  if (!isLocalTarget(baseUrl)) {
    return `target ${baseUrl} is not loopback/private — refusing to cache or reuse sessions against it`;
  }
  return null;
}

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

function writeCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch (e) {
    // A cache that cannot be written costs one OTP dispatch, nothing more. It must never
    // become a test failure, and it must never be reported as if sessions were shared.
  }
}

function keyFor(baseUrl, phone, role) {
  // Scoped to the host:port on purpose: a token minted against one server process is not
  // presented to a different one, so a stale cache cannot make a suite believe it is talking
  // to the server it just authenticated against.
  const { hostname, port } = new URL(baseUrl);
  return `${hostname}:${port || '80'}|${role}|${String(phone).replace(/\D/g, '')}`;
}

/**
 * @param {object}   opts
 * @param {string}   opts.baseUrl  target the suite is really talking to
 * @param {string}   opts.phone
 * @param {string}   opts.role
 * @param {Function} opts.mint     async () => token|null — the real OTP sign-in
 * @param {Function} opts.probe    async (token) => boolean — is this session still this identity
 * @param {Function} [opts.log]
 * @returns {Promise<{token: string|null, source: string, reason?: string}>}
 */
async function withSharedSession({ baseUrl, phone, role, mint, probe, log = () => {} }) {
  const blocked = refuseReason(baseUrl);
  if (blocked) {
    // Fail closed: no caching, and the caller's own sign-in path is used exactly once.
    log(`session cache disabled: ${blocked}`);
    const token = await mint();
    return { token: token || null, source: 'minted-uncached', reason: blocked };
  }

  const cache = readCache();
  const key = keyFor(baseUrl, phone, role);
  const entry = cache[key];

  if (entry && entry.token && Date.now() - (entry.at || 0) < MAX_AGE_MS) {
    let alive = false;
    try {
      alive = await probe(entry.token);
    } catch (e) {
      alive = false;
    }
    if (alive) return { token: entry.token, source: 'reused' };
    // Probing failed: the session is gone (logged out, revoked, expired, or the server was
    // restarted without it). Drop it rather than keep offering a dead credential.
    delete cache[key];
    writeCache(cache);
    log(`cached ${role} session for ${String(phone).slice(-4)} is no longer valid; re-authenticating`);
  }

  const token = await mint();
  if (token) {
    cache[key] = { token, at: Date.now(), role, phoneTail: String(phone).replace(/\D/g, '').slice(-4) };
    writeCache(cache);
    return { token, source: 'minted' };
  }
  return { token: null, source: 'failed' };
}

/** Used by a suite that is about to restart the server and must not trust cached sessions. */
function invalidateAll() {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.rmSync(CACHE_FILE);
  } catch (e) { /* best effort */ }
}

/**
 * Build a `login(phone, role)` for a suite that already has a
 * `request(method, path, body, headers)` helper pointed at `baseUrl`.
 *
 * This exists so that "get me a session I can act with" is written once and means the same
 * thing in every suite: an identity that is already signed in is *not* signed in again, and a
 * cached token is only trusted after `GET /api/auth/me` says it is live and carries the role
 * being asked for. Suites that previously minted a fresh OTP per run — because the OTP was a
 * means to a session rather than the thing under test — now cost at most one dispatch per
 * identity per window, which is what makes the chain order-independent.
 *
 * Authentication is not weakened by any part of this: the sign-in still goes through
 * send-otp/verify-otp, the probe still requires the server's own confirmation of identity and
 * role, and a failure is returned as a failure with the server's reason attached so the caller
 * can refuse to run rather than assert against an unauthenticated request.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {Function} opts.request  (method, path, body, headers) => {status, data}
 * @param {Function} [opts.headerFor]  override the Authorization header shape
 * @returns {Function} async (phone, role) => { token, user, source, failure }
 */
function createLogin({ baseUrl, request, headerFor }) {
  const authHeader = headerFor || ((token) => ({ Authorization: `Bearer ${token}` }));

  return async function login(phone, role) {
    let failure = null;

    const mint = async () => {
      const send = await request('POST', '/api/auth/send-otp', { phone, role, purpose: 'LOGIN' });
      if (!send || !send.data || send.data.success !== true) {
        failure = { stage: 'send', status: send && send.status, body: send && send.data };
        return null;
      }
      const verify = await request('POST', '/api/auth/verify-otp', {
        phone, otp: send.data.testOtp || '7729', role, purpose: 'LOGIN',
      });
      if (!verify || !verify.data || !verify.data.token) {
        failure = { stage: 'verify', status: verify && verify.status, body: verify && verify.data };
        return null;
      }
      failure = null;
      return verify.data.token;
    };

    const whoAmI = async (candidate) => request('GET', '/api/auth/me', null, authHeader(candidate));

    const probe = async (candidate) => {
      const me = await whoAmI(candidate);
      const user = me && me.data && me.data.user;
      const actual = String((me && me.data && me.data.role) || (user && user.role) || '').toUpperCase();
      return Boolean(me && me.status === 200 && me.data && me.data.success === true
        && user && actual === String(role).toUpperCase());
    };

    const { token, source } = await withSharedSession({ baseUrl, phone, role, mint, probe });
    if (!token) return { token: null, user: null, source, failure };
    const me = await whoAmI(token);
    return { token, user: (me.data && me.data.user) || null, source, failure: null };
  };
}

module.exports = {
  withSharedSession,
  createLogin,
  isLocalTarget,
  invalidateAll,
  CACHE_FILE,
  homedir: () => os.homedir()
};
