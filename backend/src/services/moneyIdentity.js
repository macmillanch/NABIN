/**
 * The identity of one financial operation — deliberately not a timestamp.
 *
 * Why this exists
 * ---------------
 * Two money mutations built their idempotency identity out of `Date.now()`:
 *
 *   `database.js`  `admin_adj_${targetType}_${targetId}_${direction}_${amt}_${Date.now()}`
 *   `database.js`  `payout_${driver.id}_${Date.now()}`
 *
 * `journal_transactions.idempotency_key` is UNIQUE, and `driver_payouts` has UNIQUE
 * `payout_id` and UNIQUE `idempotency_key` — the database barrier is real and already in
 * place. It only works if the key it deduplicates on *identifies the operation*. A clock
 * does neither job, in both directions:
 *
 *   - The same logical operation retried after a lost response arrives in a later
 *     millisecond, gets a NEW key, and is therefore a brand-new financial effect. A payout
 *     whose response was lost is paid twice; an adjustment submitted twice moves money
 *     twice. This is exactly the failure idempotency exists to prevent.
 *   - Two genuinely different operations issued in the *same* millisecond get the *same*
 *     key. For the payout row that means a UNIQUE `payout_id` violation on a write whose
 *     error was never checked, so the ledger has already moved the money while no payout
 *     record exists.
 *
 * What this is NOT
 * ----------------
 * This module does not decide which store is a driver's authoritative balance (Phase 12
 * left that open deliberately), does not touch settlement semantics, eligibility rules or
 * chart-of-account balances, and does not reconstruct history. It only names an operation
 * so that an existing database constraint can do its job.
 *
 * Scoping
 * -------
 * The key is prefixed with the acting account, so a key is meaningful only inside its
 * owner's namespace. That is not authorisation — an attacker who guesses someone else's
 * key still has to pass the route's authentication and ownership checks — but it does mean
 * presenting a borrowed key can never *land on another account's money*, because it simply
 * is not the same key once the account is part of it.
 */
const crypto = require('crypto');

// `journal_transactions.idempotency_key` and `driver_payouts.idempotency_key` are both
// VARCHAR(100). A key longer than the column is not a graceful failure — Postgres raises
// 22001 and the caller sees a broken payout — so the identity is bounded here, on both
// sides of the separator, rather than truncated after assembly (which could make two
// different operations share a prefix).
const MAX_KEY_LENGTH = 100;
const CALLER_KEY_DIGEST_LENGTH = 40;

/**
 * Compose the durable identity of one financial operation.
 *
 * @param {string}   kind        the operation namespace, e.g. 'admin_adjustment'
 * @param {Array}    scope       account/actor parts that make the key non-transferable
 * @param {?string}  callerKey   an Idempotency-Key supplied by the client, if any
 * @returns {{key: string, reusedCallerKey: boolean}}
 */
function operationKey(kind, scope, callerKey) {
  const parts = [
    String(kind).replace(/[^A-Za-z0-9_]+/g, '_'),
    ...(scope || [])
      .filter((part) => part !== undefined && part !== null && String(part) !== '')
      .map((part) => String(part).replace(/[^A-Za-z0-9_.:-]+/g, '_'))
  ];

  const supplied = typeof callerKey === 'string' ? callerKey.trim() : '';
  if (supplied) {
    // Digested rather than appended: a caller must not be able to choose a string that
    // collides with another account's namespace by embedding the separator, and must not be
    // able to push the key past the column width.
    parts.push(crypto.createHash('sha256').update(supplied).digest('hex').slice(0, CALLER_KEY_DIGEST_LENGTH));
    return { key: truncate(parts.join(':')), reusedCallerKey: true };
  }

  // No caller key: a fresh UUID, never a timestamp. Two distinct operations in the same
  // millisecond stay distinct, which `Date.now()` could not guarantee. A retry without a key
  // is then correctly treated as a new operation — without one there is genuinely nothing to
  // tell a retry from an intention, and guessing wrong here would silently drop a legitimate
  // second payout.
  parts.push(crypto.randomUUID());
  return { key: truncate(parts.join(':')), reusedCallerKey: false };
}

function truncate(value) {
  if (value.length <= MAX_KEY_LENGTH) return value;
  // Keep the scope readable and make the tail unique: hashing the overflow means two keys
  // that share a long prefix still differ, which a plain slice would not guarantee.
  const digest = crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${value.slice(0, MAX_KEY_LENGTH - digest.length - 1)}:${digest}`;
}

/**
 * A stable business identifier for a persisted row (e.g. `driver_payouts.payout_id`, which is
 * UNIQUE). Derived from the same identity as the operation, so a retry maps to the same row
 * rather than to a second row that the database then refuses.
 */
function stableRecordId(prefix, identity) {
  const digest = crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

/**
 * The canonical header spellings, in the order every other mutating route here uses.
 * `Idempotency-Key` is the one the CORS allow-list grants; see `server.js` `allowedHeaders`.
 */
function readIdempotencyHeader(req) {
  const headers = (req && req.headers) || {};
  return headers['idempotency-key'] || headers['x-idempotency-key']
    || (req.body && req.body.idempotencyKey) || null;
}

module.exports = { operationKey, stableRecordId, readIdempotencyHeader, MAX_KEY_LENGTH };
