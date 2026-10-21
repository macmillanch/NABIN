'use strict';

/**
 * NABIN — Authoritative Financial Reconciler Security & Target Guard Service
 *
 * Implements strict, zero-trust target verification, in-band database identity checks,
 * certificate-pinned TLS enforcement, cryptographic signature verification,
 * and a two-stage human approval gate for ledger reconciliation.
 *
 * Mode: Pure functional implementation. Hermetically testable with zero network I/O.
 */

const crypto = require('crypto');
const dbTls = require('./dbTls');

const FORBIDDEN_PROD_REF = 'ouxvqmhuyueklnegvmxe';
const SANCTIONED_STAGING_REF = 'ywhxkzmbwppkdemvzlhv';

const SANCTIONED_STAGING_HOST_PATTERNS = [
  /^aws-0-ap-northeast-1\.pooler\.supabase\.com$/i,
  /^db\.ywhxkzmbwppkdemvzlhv\.supabase\.co$/i
];

const SANCTIONED_STAGING_PORTS = ['5432', '6543'];
const ALLOWED_DATABASE_SCHEMES = ['postgresql:', 'postgres:'];
const LOCAL_HOST_PATTERN = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|0\.0\.0\.0|host\.docker\.internal)$/i;
const PLACEHOLDER_PATTERN = /(?:paste|your[_-]|change[_-]?me|replace|placeholder|todo|fixme|example|xxxx)/i;

const MAX_APPROVAL_TTL_MS = 60 * 60 * 1000; // 60 minutes
const REQUIRED_OPERATION_NAME = 'FINANCIAL_LEDGER_BACKFILL_EXECUTE';

const defaultConsumedNonces = new Set();

class ReconcilerSecurityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ReconcilerSecurityError';
    this.code = code || 'RECONCILER_SECURITY_REFUSED';
  }
}

/**
 * Redact a connection URL to scheme, host, and port only (names/passwords stripped).
 */
function redactTarget(connectionString) {
  if (!connectionString) return '(empty)';
  try {
    const parsed = new URL(connectionString);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
  } catch (err) {
    return '(unparsable)';
  }
}

/**
 * Validates the target parameter and database URL.
 *
 * @param {Object} options
 * @param {string} options.target - 'local' or 'staging'
 * @param {string} options.dbUrl - Database connection string
 * @param {Object} [options.env] - Environment variables dictionary
 * @returns {Object} Target validation report
 */
function validateTargetConfiguration({ target, dbUrl, env = process.env }) {
  if (!target || (target !== 'local' && target !== 'staging')) {
    throw new ReconcilerSecurityError(
      `Invalid or missing target parameter "${target}". Must be explicitly "--target=local" or "--target=staging".`,
      'INVALID_TARGET_PARAMETER'
    );
  }

  if (!dbUrl || typeof dbUrl !== 'string') {
    throw new ReconcilerSecurityError(
      'Missing or invalid database connection string (DATABASE_URL).',
      'MISSING_DATABASE_URL'
    );
  }

  // 1. Prohibit production project references anywhere in parameters, URLs, or environment
  const candidatesToCheck = [dbUrl, env.NABIN_SUPABASE_REF, env.SUPABASE_URL, env.STAGING_DATABASE_URL];
  for (const item of candidatesToCheck) {
    if (item && String(item).includes(FORBIDDEN_PROD_REF)) {
      throw new ReconcilerSecurityError(
        `Production project reference "${FORBIDDEN_PROD_REF}" detected in configuration. Immediate refusal.`,
        'PRODUCTION_TARGET_FORBIDDEN'
      );
    }
  }

  // 2. Parse URL and validate scheme
  let parsedUrl;
  try {
    parsedUrl = new URL(dbUrl);
  } catch (err) {
    throw new ReconcilerSecurityError(
      `DATABASE_URL is not a valid URL: ${err.message}`,
      'INVALID_DATABASE_URL_FORMAT'
    );
  }

  const protocol = (parsedUrl.protocol || '').toLowerCase();
  if (!ALLOWED_DATABASE_SCHEMES.includes(protocol)) {
    throw new ReconcilerSecurityError(
      `Database scheme "${protocol}" is not permitted. Only "postgresql:" or "postgres:" are approved.`,
      'UNAPPROVED_DATABASE_SCHEME'
    );
  }

  const hostname = (parsedUrl.hostname || '').toLowerCase();
  if (/prod|production/i.test(hostname) && !/staging|test/i.test(hostname)) {
    throw new ReconcilerSecurityError(
      `Production hostname indicator detected in database URL (${redactTarget(dbUrl)}).`,
      'PRODUCTION_INDICATOR_DETECTED'
    );
  }

  // 3. Prohibit placeholder credentials
  const rawPassword = decodeURIComponent(parsedUrl.password || '');
  if (PLACEHOLDER_PATTERN.test(rawPassword)) {
    throw new ReconcilerSecurityError(
      'DATABASE_URL password contains an unfilled placeholder template. Configure real credentials before running.',
      'PLACEHOLDER_CREDENTIAL_REFUSED'
    );
  }

  const port = parsedUrl.port || '5432';

  // 4. Target Mode Specific Validation
  if (target === 'local') {
    if (!LOCAL_HOST_PATTERN.test(hostname)) {
      throw new ReconcilerSecurityError(
        `Target declared as local, but DATABASE_URL points to non-loopback host "${hostname}". Refused.`,
        'LOCAL_TARGET_MISMATCH'
      );
    }

    if (!/^\d+$/.test(port)) {
      throw new ReconcilerSecurityError(
        `Local database port "${port}" is invalid.`,
        'INVALID_DATABASE_PORT'
      );
    }

    return {
      target: 'local',
      host: hostname,
      port,
      isLoopback: true,
      ssl: false,
      redactedUrl: redactTarget(dbUrl)
    };
  }

  if (target === 'staging') {
    if (LOCAL_HOST_PATTERN.test(hostname)) {
      throw new ReconcilerSecurityError(
        `Target declared as staging, but DATABASE_URL points to local loopback host "${hostname}". Refused.`,
        'STAGING_TARGET_LOOPBACK_FORBIDDEN'
      );
    }

    const isSanctionedHost = SANCTIONED_STAGING_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
    if (!isSanctionedHost) {
      throw new ReconcilerSecurityError(
        `Target declared as staging, but host "${hostname}" does not match sanctioned staging endpoints for project ${SANCTIONED_STAGING_REF}.`,
        'UNAPPROVED_STAGING_ENDPOINT'
      );
    }

    if (!SANCTIONED_STAGING_PORTS.includes(port)) {
      throw new ReconcilerSecurityError(
        `Staging database port "${port}" is not permitted. Only 5432 (session/direct) or 6543 (transaction pooler) are approved.`,
        'UNAPPROVED_STAGING_PORT'
      );
    }

    // Verify username format for pooler vs direct
    const username = decodeURIComponent(parsedUrl.username || '');
    const isPoolerUser = username === `postgres.${SANCTIONED_STAGING_REF}`;
    const isDirectUser = username === 'postgres';
    if (!isPoolerUser && !isDirectUser) {
      throw new ReconcilerSecurityError(
        `Staging database username "${username}" is not sanctioned for project ${SANCTIONED_STAGING_REF}.`,
        'UNAPPROVED_STAGING_USER'
      );
    }

    // TLS enforcement via shared policy
    let ssl;
    try {
      ssl = dbTls.sslConfig(dbUrl, env);
    } catch (err) {
      throw new ReconcilerSecurityError(
        `Database TLS policy refused staging target: ${err.message}`,
        err.code || 'STAGING_TLS_POLICY_REFUSED'
      );
    }

    if (ssl === false) {
      throw new ReconcilerSecurityError(
        'Database TLS policy resolved staging target to an unencrypted connection. TLS is mandatory for staging.',
        'STAGING_TLS_REQUIRED'
      );
    }

    return {
      target: 'staging',
      host: hostname,
      port,
      user: username,
      isLoopback: false,
      ssl,
      redactedUrl: redactTarget(dbUrl)
    };
  }
}

/**
 * Executes in-band catalog verification to probe session identity and baseline.
 * Note: In-band probes are defense-in-depth and cannot replace TLS certificate verification.
 *
 * @param {Object} client - PostgreSQL client or mock
 * @param {string} target - 'local' or 'staging'
 * @returns {Promise<Object>} In-band verification report
 */
async function verifyInBandDatabaseIdentity({ client, target }) {
  if (!client || typeof client.query !== 'function') {
    throw new ReconcilerSecurityError(
      'Valid PostgreSQL client required for in-band verification.',
      'INVALID_CLIENT'
    );
  }

  // 1. Query database session identity
  const idRes = await client.query('SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS ip;');
  if (!idRes || !idRes.rows || idRes.rows.length === 0) {
    throw new ReconcilerSecurityError(
      'Failed to query database session identity catalog.',
      'DATABASE_IDENTITY_QUERY_FAILED'
    );
  }

  const { db, usr, ip } = idRes.rows[0];

  if (db !== 'postgres') {
    throw new ReconcilerSecurityError(
      `Database identity mismatch: connected to "${db}", expected "postgres".`,
      'DATABASE_IDENTITY_MISMATCH'
    );
  }

  if (target === 'staging') {
    const expectedPoolerUser = `postgres.${SANCTIONED_STAGING_REF}`;
    if (usr !== expectedPoolerUser && usr !== 'postgres') {
      throw new ReconcilerSecurityError(
        `Database user mismatch: session user is "${usr}", expected "${expectedPoolerUser}" or "postgres".`,
        'DATABASE_USER_MISMATCH'
      );
    }
  }

  // 2. Query authoritative migration baseline
  const migRes = await client.query(
    "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '039';"
  );

  if (!migRes || !migRes.rows || migRes.rows.length === 0) {
    throw new ReconcilerSecurityError(
      'Migration 039 is absent from catalog (supabase_migrations.schema_migrations). Reconciler requires Migration 039 baseline.',
      'BASELINE_MIGRATION_MISSING'
    );
  }

  return {
    verified: true,
    target,
    connectedDatabase: db,
    connectedUser: usr,
    serverIp: ip ? String(ip) : '(socket)',
    migration039Active: true,
    migrationName: migRes.rows[0].name || '039_atomic_double_entry_capture_and_refund'
  };
}

/**
 * Returns SQL statement for entering engine-level READ ONLY transaction.
 */
function getDryRunTransactionSql() {
  return 'BEGIN TRANSACTION READ ONLY;';
}

/**
 * Returns SQL statement for rolling back dry-run transaction.
 */
function getDryRunRollbackSql() {
  return 'ROLLBACK;';
}

/**
 * Deterministically computes the SHA-256 manifest digest of a dry-run report.
 * Binds every accounting-relevant field.
 *
 * @param {Object} report
 * @returns {string} SHA-256 hex digest
 */
function computeReportManifest(report) {
  if (!report || typeof report !== 'object') {
    throw new ReconcilerSecurityError('Invalid dry-run report object.', 'INVALID_REPORT_OBJECT');
  }

  const normalizedCandidates = (report.candidateEntries || [])
    .map((c) => ({
      entry_id: String(c.entry_id || '').trim(),
      reference_id: String(c.reference_id || '').trim(),
      category: String(c.category || '').trim(),
      amount: Number(c.amount).toFixed(2),
      debit_account: String(c.debit_account || '').trim(),
      credit_account: String(c.credit_account || '').trim(),
      created_at: String(c.created_at || '').trim(),
      job_id: String(c.job_id || '').trim(),
      currency: String(c.currency || 'INR').trim()
    }))
    .sort((a, b) => a.entry_id.localeCompare(b.entry_id));

  const manifestPayload = {
    target: String(report.target || ''),
    projectRef: String(report.projectRef || (report.target === 'staging' ? SANCTIONED_STAGING_REF : '')),
    baselineVersion: String(report.baselineVersion || '039'),
    candidateCount: Number(report.candidateCount || 0),
    totalDebit: Number(report.totalDebit || 0).toFixed(2),
    totalCredit: Number(report.totalCredit || 0).toFixed(2),
    quarantinedCount: Number(report.quarantinedCount || 0),
    candidateEntries: normalizedCandidates
  };

  const serialized = JSON.stringify(manifestPayload);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Canonical string representation of approval payload for cryptographic signature.
 */
function getCanonicalApprovalPayload(artifact) {
  const fields = [
    String(artifact.target || ''),
    String(artifact.projectRef || ''),
    String(artifact.operation || ''),
    String(artifact.manifestDigest || ''),
    String(artifact.candidateCount !== undefined ? artifact.candidateCount : ''),
    Number(artifact.totalAmount || 0).toFixed(2),
    String(artifact.issuedAtMs || ''),
    String(artifact.expiresAtMs || ''),
    String(artifact.nonce || ''),
    String(artifact.approvedBy || '')
  ];

  for (const f of fields) {
    if (/[\r\n\t|]/.test(f)) {
      throw new ReconcilerSecurityError(
        'Control characters and pipe delimiters are strictly prohibited in canonical approval fields.',
        'APPROVAL_FIELD_DELIMITER_INJECTION'
      );
    }
  }

  return ['NABIN_FINANCIAL_RECONCILER_APPROVAL_V1', ...fields].join('|');
}

/**
 * Test helper: signs an approval artifact with a given Ed25519/RSA private key.
 * Used exclusively in hermetic tests.
 */
function signApprovalPayloadForTesting({ artifact, privateKey }) {
  const canonical = getCanonicalApprovalPayload(artifact);
  return crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('hex');
}

/**
 * Validates human owner approval, cryptographic signature, and checks for candidate-set drift.
 *
 * @param {Object} options
 * @param {Object} options.dryRunReport - Deterministic dry-run report
 * @param {Object} options.approvalArtifact - Explicit owner approval document with digital signature
 * @param {Array} options.liveCandidateSet - Current live candidates detected at backfill time
 * @param {number} [options.currentTimestampMs] - Current time in ms
 * @param {string|crypto.KeyObject} [options.trustedPublicKey] - Owner public key (Ed25519 or PEM)
 * @param {string} [options.expectedOwnerIdentity] - Expected owner identity
 * @param {Set} [options.consumedNonces] - Nonce tracking set for replay rejection
 * @returns {Object} Approval validation result
 */
function validateBackfillExecutionAuthorization({
  dryRunReport,
  approvalArtifact,
  liveCandidateSet,
  currentTimestampMs = Date.now(),
  trustedPublicKey = process.env.NABIN_RECONCILER_OWNER_PUBLIC_KEY,
  expectedOwnerIdentity = process.env.NABIN_RECONCILER_OWNER_IDENTITY,
  consumedNonces = defaultConsumedNonces
}) {
  if (!approvalArtifact || typeof approvalArtifact !== 'object') {
    throw new ReconcilerSecurityError(
      'Missing explicit owner approval artifact. Live backfill cannot proceed without written owner authorization.',
      'APPROVAL_ARTIFACT_MISSING'
    );
  }

  if (approvalArtifact.approvalStatus !== 'APPROVED') {
    throw new ReconcilerSecurityError(
      `Approval artifact status is "${approvalArtifact.approvalStatus}". Expected "APPROVED".`,
      'APPROVAL_STATUS_NOT_APPROVED'
    );
  }

  if (!approvalArtifact.approvedBy || typeof approvalArtifact.approvedBy !== 'string' || !approvalArtifact.approvedBy.trim()) {
    throw new ReconcilerSecurityError(
      'Approval artifact must specify the approving owner identity (approvedBy).',
      'APPROVAL_OWNER_IDENTITY_MISSING'
    );
  }

  // 1. Target and Project Reference Binding
  if (approvalArtifact.target !== dryRunReport.target) {
    throw new ReconcilerSecurityError(
      `Approval artifact target "${approvalArtifact.target}" does not match dry-run report target "${dryRunReport.target}".`,
      'APPROVAL_TARGET_MISMATCH'
    );
  }

  if (dryRunReport.target === 'staging' && approvalArtifact.projectRef !== SANCTIONED_STAGING_REF) {
    throw new ReconcilerSecurityError(
      `Approval artifact project reference "${approvalArtifact.projectRef}" does not match sanctioned staging reference "${SANCTIONED_STAGING_REF}".`,
      'APPROVAL_PROJECT_REF_MISMATCH'
    );
  }

  // 2. Operation Name Binding
  if (approvalArtifact.operation !== REQUIRED_OPERATION_NAME) {
    throw new ReconcilerSecurityError(
      `Approval artifact operation "${approvalArtifact.operation}" does not match required "${REQUIRED_OPERATION_NAME}".`,
      'OPERATION_NAME_MISMATCH'
    );
  }

  // 3. Manifest Digest Binding
  const expectedDigest = computeReportManifest(dryRunReport);
  if (approvalArtifact.manifestDigest !== expectedDigest) {
    throw new ReconcilerSecurityError(
      `Approval artifact manifest digest "${approvalArtifact.manifestDigest}" does not match dry-run report digest "${expectedDigest}".`,
      'MANIFEST_DIGEST_MISMATCH'
    );
  }

  // 4. Candidate Count and Total Amount Bounds
  if (approvalArtifact.candidateCount === undefined || Number(approvalArtifact.candidateCount) !== Number(dryRunReport.candidateCount)) {
    throw new ReconcilerSecurityError(
      `Approval candidateCount (${approvalArtifact.candidateCount}) does not match report candidateCount (${dryRunReport.candidateCount}).`,
      'APPROVAL_BOUNDS_MISMATCH'
    );
  }

  const expectedAmountStr = Number(dryRunReport.totalDebit || 0).toFixed(2);
  const approvalAmountStr = Number(approvalArtifact.totalAmount || 0).toFixed(2);
  if (approvalAmountStr !== expectedAmountStr) {
    throw new ReconcilerSecurityError(
      `Approval totalAmount (₹${approvalAmountStr}) does not match report total debit (₹${expectedAmountStr}).`,
      'APPROVAL_BOUNDS_MISMATCH'
    );
  }

  // 5. Reject if dry-run report holds quarantined records
  if (dryRunReport.quarantinedCount > 0) {
    throw new ReconcilerSecurityError(
      `Dry-run report holds ${dryRunReport.quarantinedCount} quarantined record(s). Cannot backfill ambiguous records.`,
      'QUARANTINED_RECORDS_DETECTED'
    );
  }

  // 6. Nonce & Replay Protection
  if (!approvalArtifact.nonce || typeof approvalArtifact.nonce !== 'string' || approvalArtifact.nonce.trim().length < 8) {
    throw new ReconcilerSecurityError(
      'Approval artifact must provide a valid unique nonce (minimum 8 characters) for replay protection.',
      'APPROVAL_NONCE_INVALID'
    );
  }

  if (consumedNonces.has(approvalArtifact.nonce)) {
    throw new ReconcilerSecurityError(
      `Approval artifact nonce "${approvalArtifact.nonce}" has already been consumed. Replay rejected.`,
      'APPROVAL_NONCE_REPLAYED'
    );
  }

  // 7. Mandatory Issuance and Expiration Window
  if (typeof approvalArtifact.issuedAtMs !== 'number' || !Number.isFinite(approvalArtifact.issuedAtMs)) {
    throw new ReconcilerSecurityError(
      'Approval artifact must specify numeric issuedAtMs timestamp.',
      'APPROVAL_ISSUED_AT_MISSING'
    );
  }

  if (typeof approvalArtifact.expiresAtMs !== 'number' || !Number.isFinite(approvalArtifact.expiresAtMs)) {
    throw new ReconcilerSecurityError(
      'Approval artifact must specify numeric expiresAtMs timestamp. Expiration is mandatory.',
      'APPROVAL_EXPIRATION_MISSING'
    );
  }

  // Reject future-issued approvals (allow 60s clock skew)
  if (approvalArtifact.issuedAtMs > currentTimestampMs + 60000) {
    throw new ReconcilerSecurityError(
      `Approval artifact issued in the future (issuedAt: ${new Date(approvalArtifact.issuedAtMs).toISOString()}, current: ${new Date(currentTimestampMs).toISOString()}).`,
      'APPROVAL_FUTURE_ISSUED'
    );
  }

  if (approvalArtifact.expiresAtMs <= approvalArtifact.issuedAtMs) {
    throw new ReconcilerSecurityError(
      'Approval expiration timestamp must be strictly after issuance timestamp.',
      'APPROVAL_WINDOW_INVALID'
    );
  }

  const approvalLifetime = approvalArtifact.expiresAtMs - approvalArtifact.issuedAtMs;
  if (approvalLifetime > MAX_APPROVAL_TTL_MS) {
    throw new ReconcilerSecurityError(
      `Approval lifetime (${Math.round(approvalLifetime / 60000)}m) exceeds maximum permitted TTL of 60 minutes.`,
      'APPROVAL_LIFETIME_EXCESSIVE'
    );
  }

  if (currentTimestampMs >= approvalArtifact.expiresAtMs) {
    throw new ReconcilerSecurityError(
      `Approval artifact has expired (expired at ${new Date(approvalArtifact.expiresAtMs).toISOString()}). Re-run dry-run and obtain fresh approval.`,
      'APPROVAL_WINDOW_EXPIRED'
    );
  }

  // 8. Cryptographic Digital Signature Verification
  if (!trustedPublicKey || (typeof trustedPublicKey !== 'string' && typeof trustedPublicKey !== 'object')) {
    throw new ReconcilerSecurityError(
      'Trusted owner public key is not configured. Live execution requires independent owner key configuration (NABIN_RECONCILER_OWNER_PUBLIC_KEY).',
      'OWNER_PUBLIC_KEY_UNCONFIGURED'
    );
  }

  if (expectedOwnerIdentity && approvalArtifact.approvedBy !== expectedOwnerIdentity) {
    throw new ReconcilerSecurityError(
      `Approval approvedBy "${approvalArtifact.approvedBy}" does not match configured owner identity "${expectedOwnerIdentity}".`,
      'APPROVAL_OWNER_IDENTITY_MISMATCH'
    );
  }

  if (!approvalArtifact.signature || typeof approvalArtifact.signature !== 'string' || !approvalArtifact.signature.trim()) {
    throw new ReconcilerSecurityError(
      'Approval artifact is missing cryptographic signature. Editable JSON without digital signature is refused.',
      'APPROVAL_SIGNATURE_MISSING'
    );
  }

  const canonicalPayload = getCanonicalApprovalPayload(approvalArtifact);
  try {
    const isVerified = crypto.verify(
      null,
      Buffer.from(canonicalPayload, 'utf8'),
      trustedPublicKey,
      Buffer.from(approvalArtifact.signature, 'hex')
    );
    if (!isVerified) {
      throw new ReconcilerSecurityError(
        'Cryptographic verification of owner approval signature failed. Signature does not match approved payload.',
        'APPROVAL_SIGNATURE_INVALID'
      );
    }
  } catch (err) {
    if (err instanceof ReconcilerSecurityError) throw err;
    throw new ReconcilerSecurityError(
      `Cryptographic signature verification error: ${err.message}`,
      'APPROVAL_SIGNATURE_INVALID'
    );
  }

  // 9. Candidate Set Full-Tuple Drift Detection (zero drift tolerance across all accounting fields)
  if (!Array.isArray(liveCandidateSet)) {
    throw new ReconcilerSecurityError(
      'Live candidate set must be an array for drift verification.',
      'INVALID_LIVE_CANDIDATE_SET'
    );
  }

  if (liveCandidateSet.length !== dryRunReport.candidateCount) {
    throw new ReconcilerSecurityError(
      `Candidate set drift detected: live candidates count (${liveCandidateSet.length}) diverges from reviewed report count (${dryRunReport.candidateCount}).`,
      'CANDIDATE_SET_DRIFT_DETECTED'
    );
  }

  const reviewedMap = new Map();
  for (const c of dryRunReport.candidateEntries || []) {
    reviewedMap.set(c.entry_id, {
      entry_id: String(c.entry_id || '').trim(),
      reference_id: String(c.reference_id || '').trim(),
      category: String(c.category || '').trim(),
      amount: Number(c.amount).toFixed(2),
      debit_account: String(c.debit_account || '').trim(),
      credit_account: String(c.credit_account || '').trim(),
      created_at: String(c.created_at || '').trim(),
      job_id: String(c.job_id || '').trim(),
      currency: String(c.currency || 'INR').trim()
    });
  }

  for (const live of liveCandidateSet) {
    const liveId = String(live.entry_id || '').trim();
    if (!reviewedMap.has(liveId)) {
      throw new ReconcilerSecurityError(
        `Candidate set drift detected: unreviewed candidate "${liveId}" appeared in live scan.`,
        'CANDIDATE_SET_DRIFT_DETECTED'
      );
    }

    const rev = reviewedMap.get(liveId);
    const liveNormalized = {
      entry_id: liveId,
      reference_id: String(live.reference_id || '').trim(),
      category: String(live.category || '').trim(),
      amount: Number(live.amount).toFixed(2),
      debit_account: String(live.debit_account || '').trim(),
      credit_account: String(live.credit_account || '').trim(),
      created_at: String(live.created_at || '').trim(),
      job_id: String(live.job_id || '').trim(),
      currency: String(live.currency || 'INR').trim()
    };

    for (const field of ['amount', 'debit_account', 'credit_account', 'category', 'reference_id', 'created_at', 'job_id', 'currency']) {
      if (liveNormalized[field] !== rev[field]) {
        throw new ReconcilerSecurityError(
          `Candidate set drift detected: ${field} for "${liveId}" changed from "${rev[field]}" to "${liveNormalized[field]}".`,
          'CANDIDATE_SET_DRIFT_DETECTED'
        );
      }
    }
  }

  // Consume nonce to prevent replay
  consumedNonces.add(approvalArtifact.nonce);

  return {
    authorized: true,
    manifestDigest: expectedDigest,
    approvedBy: approvalArtifact.approvedBy,
    candidateCount: dryRunReport.candidateCount,
    nonce: approvalArtifact.nonce,
    verifiedAt: new Date(currentTimestampMs).toISOString()
  };
}

module.exports = {
  ReconcilerSecurityError,
  redactTarget,
  validateTargetConfiguration,
  verifyInBandDatabaseIdentity,
  getDryRunTransactionSql,
  getDryRunRollbackSql,
  computeReportManifest,
  getCanonicalApprovalPayload,
  signApprovalPayloadForTesting,
  validateBackfillExecutionAuthorization,
  defaultConsumedNonces,
  FORBIDDEN_PROD_REF,
  SANCTIONED_STAGING_REF,
  SANCTIONED_STAGING_HOST_PATTERNS,
  SANCTIONED_STAGING_PORTS,
  ALLOWED_DATABASE_SCHEMES,
  MAX_APPROVAL_TTL_MS,
  REQUIRED_OPERATION_NAME
};
