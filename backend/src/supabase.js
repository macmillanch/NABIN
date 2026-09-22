const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Guarantee WebSocket global for Supabase Realtime compatibility
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('your-project-id') && 
  !supabaseAnonKey.includes('your-supabase')
);

const isLivePostgres = Boolean(isConfigured && (process.env.SUPABASE_POSTGRES_LIVE === 'true' || process.env.NODE_ENV === 'production'));

// PRODUCTION FAIL-CLOSED GUARD
if (process.env.NODE_ENV === 'production' && !isConfigured) {
  const fatalMsg = 'FATAL DATABASE ERROR: In production mode (NODE_ENV=production), valid SUPABASE_URL and SUPABASE_ANON_KEY must be configured. Backend will FAIL CLOSED rather than use unpersisted memory or local files.';
  console.error(`🚨 ${fatalMsg}`);
  throw new Error(fatalMsg);
}

let supabase = null;
let supabaseAdmin = null;

if (isConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
    console.log('✅ Supabase PostgreSQL Client initialized successfully with URL:', supabaseUrl);
  } catch (err) {
    console.error('⚠️ Error initializing Supabase client:', err.message);
    if (process.env.NODE_ENV === 'production') {
      throw err;
    }
  }
} else {
  console.log('ℹ️ Supabase environment variables not configured. Operating in development mode.');
}

/**
 * Authoritative Readiness & DB Health Check
 */
async function checkSupabaseConnection() {
  if (!isConfigured || !supabase) {
    if (process.env.NODE_ENV === 'production') {
      return { configured: false, connected: false, ready: false, mode: 'PRODUCTION_UNCONFIGURED_ERROR' };
    }
    return { configured: false, connected: true, ready: true, mode: 'DEVELOPMENT_LOCAL_MODE' };
  }
  try {
    const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
    if (error) {
      return { configured: true, connected: false, ready: false, error: error.message, mode: 'POSTGRES_DISCONNECTED' };
    }
    return { configured: true, connected: true, ready: true, mode: 'SUPABASE_POSTGRES_LIVE', userCount: data };
  } catch (e) {
    return { configured: true, connected: false, ready: false, error: e.message, mode: 'POSTGRES_ERROR' };
  }
}

/**
 * A store that is refusing and a store that is gone are different answers.
 *
 * Lifted from the campaign work, where this distinction was first proven out, so the
 * rest of the API classifies an outage the same way rather than inventing a second,
 * slightly different test that drifts from the first.
 */
// PGRST001..003 are PostgREST's "could not reach the database / could not parse the
// response" family and PGRST5xx is its proxy-family; 57Pxx and 08xxx are PostgreSQL's
// own admin-shutdown and connection-failure classes. All of them are the outage.
function isUnreachableWireCode(code) {
  const c = String(code || '');
  return c === 'PGRST001' || c === 'PGRST002' || c === 'PGRST003'
    || c === '53300' || c === '57P01' || c === '57P02' || c === '57P03'
    || c === '08000' || c === '08001' || c === '08003' || c === '08006'
    || /^PGRST5\d\d$/.test(c);
}

function isStoreUnreachable(err) {
  if (!err) return false;
  // supabase-js names the HTTP status two different ways depending on where the failure
  // came from, and Kong answers a dead database with 502/503 rather than a connection
  // error, so both spellings are checked.
  const status = Number(err.status || err.statusCode);
  if (status === 502 || status === 503 || status === 504) return true;
  // PostgREST's own wire codes for "the backend behind me did not answer".
  if (isUnreachableWireCode(err.code)) return true;
  const cause = err.cause || {};
  const text = [err.code, err.message, err.details, cause.code, cause.syscall, cause.message]
    .filter(Boolean)
    .join(' ');
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|fetch failed|failed to contact database|not reachable|could not connect|connection terminated|upstream|Database connection error/i.test(text);
}

/**
 * Turn a PostgreSQL/PostgREST failure into the answer a client should get.
 *
 * The whole reason this exists in one place: `if (error) return res.status(400).json(
 * { error: error.message })` was repeated across the API, so a database that was
 * simply down answered "your request is invalid" — and the client, believing that its
 * own data was at fault, stopped retrying and lost the work. A local outage audit
 * (`outage_semantics_audit.js`) caught a customer-facing browse and a coupon write
 * doing exactly that.
 *
 * Three rules decide every case:
 *   - A store that is gone is the server's condition: 503, retryable, never a 4xx.
 *   - A store that refused *this row* is the caller's condition: 4xx, and it is
 *     PostgreSQL's own code that says which, not the wording of its message.
 *   - What PostgreSQL printed is logged, never sent. `duplicate key value violates
 *     unique constraint "campaigns_code_key"` is a schema diagram, and an unauthenticated
 *     caller has no business reading one.
 *
 * `P0001` is the exception worth naming: that is PL/pgSQL's own `RAISE`, so the text
 * was written by whoever wrote the function — a deliberate business refusal such as
 * the settlement RPCs' `IDEMPOTENCY_CONFLICT`. Passing it through unchanged is the
 * point; translating it would hide the reason from the one person who can act on it.
 */
function storeReply(err, options = {}) {
  const what = options.what || 'request';
  const detail = err
    ? [err.message, err.details, err.hint, err.code].filter(Boolean).join(' | ')
    : 'unknown store failure';
  const code = err && err.code ? String(err.code) : '';

  if (isStoreUnreachable(err)) {
    return {
      status: 503,
      code: options.unreachableCode || 'STORE_UNAVAILABLE',
      error: `The ${what} cannot be served right now because the database is not reachable. This is our side, not yours — try again in a moment.`,
      detail
    };
  }
  // A schema that has not been migrated is the deployment's fault. Answering 400 here
  // tells the caller to fix data that was never the problem, and hides the fact that
  // the environment is missing tables.
  if (code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204') {
    return {
      status: 500,
      code: 'SCHEMA_NOT_READY',
      error: `The ${what} could not be served because this backend's database schema is not fully applied.`,
      detail
    };
  }
  if (code === '23505') {
    return {
      status: 409,
      code: 'ALREADY_EXISTS',
      error: `That ${what} collides with one that already exists, and each of these has to stay unique. Nothing was changed.`,
      detail
    };
  }
  if (code === '23503') {
    return {
      status: 400,
      code: 'REFERENCE_NOT_FOUND',
      error: `The ${what} names a record that does not exist, so it was refused.`,
      detail
    };
  }
  if (code === '23502') {
    return { status: 400, code: 'VALUE_REQUIRED', error: `The ${what} is missing a value the record requires.`, detail };
  }
  if (code === '23514') {
    return { status: 400, code: 'VALUE_NOT_ALLOWED', error: `The ${what} has a value outside what this record allows.`, detail };
  }
  if (code === '22P02' || code === '22001' || code === '22003' || code === '22007') {
    return { status: 400, code: 'INVALID_VALUE', error: `The ${what} has a value in a form the record cannot hold.`, detail };
  }
  if (code === 'P0001') {
    return { status: 400, code: 'RECORD_REFUSED', error: err.message || `The ${what} was refused.`, detail };
  }
  // Anything unclassified is the server's, not the caller's: a 4xx here would blame
  // someone who did nothing wrong for a fault they cannot see.
  return {
    status: 500,
    code: 'STORE_ERROR',
    error: `The ${what} could not be completed.`,
    detail
  };
}

module.exports = {
  supabase,
  supabaseAdmin,
  isConfigured,
  isLivePostgres,
  checkSupabaseConnection,
  isStoreUnreachable,
  storeReply
};
