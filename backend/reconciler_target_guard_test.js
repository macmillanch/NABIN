'use strict';

/**
 * =========================================================================
 * NABIN — RECONCILER TARGET GUARD & APPROVAL SAFETY UNIT TEST SUITE
 *
 * Hermetic, pure-functional tests. Zero network calls, zero remote sockets,
 * zero database mutations.
 *
 * Verifies:
 * 1. Target parameter, schemes, port allowlists, and production rejection
 * 2. Loopback/hosted target mismatch refusals
 * 3. Unapproved/rogue staging endpoint refusals
 * 4. Pinned TLS enforcement & CA fingerprint fail-closed refusal
 * 5. Placeholder password refusals and credential redaction
 * 6. In-band database identity & Migration 039 catalog checks
 * 7. Engine-level READ ONLY transaction enforcement
 * 8. Deterministic manifest hashing covering all accounting fields
 * 9. Mandatory approval expiration, issuance window, and 60m max TTL
 * 10. Exact target, project ref, operation name, and bounds binding
 * 11. Replay protection & unique nonce handling
 * 12. Ed25519 cryptographic digital signature verification
 * 13. Full-tuple candidate set drift detection across all accounting fields
 * =========================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sec = require('./src/services/reconcilerSecurity');
const dbTls = require('./src/services/dbTls');

const {
  validateTargetConfiguration,
  verifyInBandDatabaseIdentity,
  getDryRunTransactionSql,
  getDryRunRollbackSql,
  computeReportManifest,
  getCanonicalApprovalPayload,
  signApprovalPayloadForTesting,
  validateBackfillExecutionAuthorization,
  redactTarget,
  FORBIDDEN_PROD_REF,
  SANCTIONED_STAGING_REF,
  REQUIRED_OPERATION_NAME
} = sec;

const checks = [];
function check(id, cond, desc) {
  checks.push({ id, ok: Boolean(cond), desc });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${desc || ''}`);
}

const PW = 'RealValidPassword123!';
const POOLER_HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
const DIRECT_HOST = `db.${SANCTIONED_STAGING_REF}.supabase.co`;

const validStagingUrl = `postgresql://postgres.${SANCTIONED_STAGING_REF}:${PW}@${POOLER_HOST}:5432/postgres`;
const validStagingTxnPoolerUrl = `postgresql://postgres.${SANCTIONED_STAGING_REF}:${PW}@${POOLER_HOST}:6543/postgres`;
const validLocalUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function expectError(fn) {
  try {
    fn();
    return { threw: false, code: null };
  } catch (err) {
    return { threw: true, code: err.code || err.message, err };
  }
}

async function expectAsyncError(asyncFn) {
  try {
    await asyncFn();
    return { threw: false, code: null };
  } catch (err) {
    return { threw: true, code: err.code || err.message, err };
  }
}

console.log('========================================================================');
console.log('NABIN — RECONCILER TARGET GUARD & APPROVAL SAFETY UNIT TEST SUITE');
console.log('========================================================================\n');

// -------------------------------------------------------------------------
// SECTION 1: TARGET PARAMETER, SCHEME, PORT & PRODUCTION REJECTION
// -------------------------------------------------------------------------
{
  const r1 = expectError(() => validateTargetConfiguration({ target: null, dbUrl: validLocalUrl }));
  check('RT-01', r1.threw && r1.code === 'INVALID_TARGET_PARAMETER', 'omitted target flag throws INVALID_TARGET_PARAMETER');

  const r2 = expectError(() => validateTargetConfiguration({ target: 'prod', dbUrl: validLocalUrl }));
  check('RT-02', r2.threw && r2.code === 'INVALID_TARGET_PARAMETER', 'target=prod throws INVALID_TARGET_PARAMETER');

  const r3 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: `postgresql://postgres.${FORBIDDEN_PROD_REF}:${PW}@${POOLER_HOST}:5432/postgres`
  }));
  check('RT-03', r3.threw && r3.code === 'PRODUCTION_TARGET_FORBIDDEN', 'production ref in DATABASE_URL throws PRODUCTION_TARGET_FORBIDDEN');

  const r4 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: validStagingUrl,
    env: { NABIN_SUPABASE_REF: FORBIDDEN_PROD_REF }
  }));
  check('RT-04', r4.threw && r4.code === 'PRODUCTION_TARGET_FORBIDDEN', 'production ref in NABIN_SUPABASE_REF throws PRODUCTION_TARGET_FORBIDDEN');

  const r5 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: `postgresql://postgres:pass@production-database.nabin.com:5432/postgres`
  }));
  check('RT-05', r5.threw && r5.code === 'PRODUCTION_INDICATOR_DETECTED', 'production keyword in hostname throws PRODUCTION_INDICATOR_DETECTED');

  const rScheme = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: `mysql://postgres.${SANCTIONED_STAGING_REF}:${PW}@${POOLER_HOST}:5432/postgres`
  }));
  check('RT-05b', rScheme.threw && rScheme.code === 'UNAPPROVED_DATABASE_SCHEME', 'unapproved database scheme (mysql) throws UNAPPROVED_DATABASE_SCHEME');

  const rPortBad = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: `postgresql://postgres.${SANCTIONED_STAGING_REF}:${PW}@${POOLER_HOST}:5433/postgres`
  }));
  check('RT-05c', rPortBad.threw && rPortBad.code === 'UNAPPROVED_STAGING_PORT', 'unapproved staging port 5433 throws UNAPPROVED_STAGING_PORT');

  const rPortTxn = validateTargetConfiguration({ target: 'staging', dbUrl: validStagingTxnPoolerUrl });
  check('RT-05d', rPortTxn.port === '6543' && rPortTxn.target === 'staging', 'sanctioned transaction pooler port 6543 is accepted');
}

// -------------------------------------------------------------------------
// SECTION 2: LOOPBACK & HOSTED MISMATCH GUARDS
// -------------------------------------------------------------------------
{
  const r6 = expectError(() => validateTargetConfiguration({ target: 'staging', dbUrl: validLocalUrl }));
  check('RT-06', r6.threw && r6.code === 'STAGING_TARGET_LOOPBACK_FORBIDDEN', 'loopback target labeled as staging throws STAGING_TARGET_LOOPBACK_FORBIDDEN');

  const r7 = expectError(() => validateTargetConfiguration({ target: 'local', dbUrl: validStagingUrl }));
  check('RT-07', r7.threw && r7.code === 'LOCAL_TARGET_MISMATCH', 'hosted target labeled as local throws LOCAL_TARGET_MISMATCH');

  const r8 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: `postgresql://postgres.other_ref:${PW}@some-other-database.example.com:5432/postgres`
  }));
  check('RT-08', r8.threw && r8.code === 'UNAPPROVED_STAGING_ENDPOINT', 'unapproved hosted domain throws UNAPPROVED_STAGING_ENDPOINT');

  const r9 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: `postgresql://unauthorized_user:${PW}@${POOLER_HOST}:5432/postgres`
  }));
  check('RT-09', r9.threw && r9.code === 'UNAPPROVED_STAGING_USER', 'unapproved staging username throws UNAPPROVED_STAGING_USER');
}

// -------------------------------------------------------------------------
// SECTION 3: CREDENTIAL PLACEHOLDERS & REDACTION
// -------------------------------------------------------------------------
{
  const r10 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: `postgresql://postgres.${SANCTIONED_STAGING_REF}:[YOUR-PASSWORD]@${POOLER_HOST}:5432/postgres`
  }));
  check('RT-10', r10.threw && r10.code === 'PLACEHOLDER_CREDENTIAL_REFUSED', 'placeholder password throws PLACEHOLDER_CREDENTIAL_REFUSED');

  const redacted = redactTarget(`postgresql://postgres.user:${PW}@${POOLER_HOST}:5432/postgres`);
  check('RT-11', !redacted.includes(PW) && redacted === `postgresql://${POOLER_HOST}:5432`, 'redactTarget strips password and username completely');
}

// -------------------------------------------------------------------------
// SECTION 4: TLS POLICY & CA FINGERPRINT FAIL-CLOSED ENFORCEMENT
// -------------------------------------------------------------------------
{
  const r12 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: validStagingUrl,
    env: { DATABASE_SSL: 'no-verify' }
  }));
  check('RT-12', r12.threw && r12.code === 'DATABASE_TLS_BYPASS_REFUSED', 'DATABASE_SSL=no-verify for staging throws DATABASE_TLS_BYPASS_REFUSED');

  const r13 = expectError(() => validateTargetConfiguration({
    target: 'staging',
    dbUrl: validStagingUrl,
    env: { DATABASE_SSL: 'disable' }
  }));
  check('RT-13', r13.threw && r13.code === 'DATABASE_TLS_BYPASS_REFUSED', 'DATABASE_SSL=disable for staging throws DATABASE_TLS_BYPASS_REFUSED');

  const stagingValid = validateTargetConfiguration({
    target: 'staging',
    dbUrl: validStagingUrl,
    env: { DATABASE_SSL: 'require' }
  });
  check('RT-14', stagingValid.ssl && stagingValid.ssl.rejectUnauthorized === true, 'valid staging configuration enforces rejectUnauthorized=true with pinned CA');

  const localValid = validateTargetConfiguration({ target: 'local', dbUrl: validLocalUrl });
  check('RT-15', localValid.ssl === false && localValid.isLoopback === true, 'valid local configuration connects without SSL to loopback');

  // Test CA fingerprint fail-closed behavior using an alternate valid CA
  const alternateCaPem = '-----BEGIN CERTIFICATE-----\n'
    + 'MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2CYajswDQYJKoZIhvcNAQELBQAw\n'
    + 'TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\n'
    + 'cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\n'
    + 'WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\n'
    + 'ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\n'
    + 'MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc\n'
    + 'h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+\n'
    + '0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U\n'
    + 'A5/TR5d8S5rgif0nxDAxn3WHirV2dZKkUgk5ftMmNtfT43d13TVPVtJQJimmx1Ao\n'
    + 'GyhTGvU7EQzYbqUArrMtBaZMhnPtDgo+sfPXycOH7O+0UPQfWqXeMrAD9G/61Twt\n'
    + 'gCxmb88yNxDGfKGZJyJWZtuooPxD676m5l2XDadZli48PFZiwt7h8lGQdcGUfKEg\n'
    + 'vvNXnvOPnjctx6EhHOYr2qwYVwcZbdqDma6h5sNw29407BkKn2NOcth+tG0PBver\n'
    + 't6IBWPOvjzLP5aGgaL23h1edGQQrWau4T4L7gWHthoC6LHsFeQY4EKWb3dGYnVAU\n'
    + 'JQYBTLmDWTVOXWhjotkpoU290xbcxqTLhJWqLiGyItJB8b422zG2kDDSvuwkWxOo\n'
    + 'xcG1SR3TbaCQg1Dv8GmlnwZah05Il27NW7SRAtuoRmUJahKOBEbCLVNwbViNW9o4\n'
    + 'IvLis67nU6488MNiSwo5Tg5ygUhgSpZ85aEjNCqGSwkYpmxlJZusvdUDeJU7Wzm/\n'
    + 'MzSXbGwfGbmRgTeZ9TyEiMSnAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV\n'
    + 'HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyRRbSppnajANBgkq\n'
    + 'hkiG9w0BAQsFAAOCAgEAVR9YqbyhurdtUSUxVm+kRgAO0dfC6TWJxVyQqKitdnQB\n'
    + 'AubRJK14vDExolVGit5HPTOO4PlQ4ENh74ztauHMzL3Za45WasmNXmWKhUKP5tnQ\n'
    + 'ZPNHS526prZS5GBucBQ++urxhTeyRIY42KZ/5aRe3qWNgkGz28S44L4m0QtSo1gs\n'
    + 'bfPCoeitLyEGj5Tx01bLtq373n32pSpPFxz6UpemQuNVlocWBqzngx7W93HMWqeq\n'
    + 'BLsrvPmWyL7ZHz5G6WDMQ/Y226C40OhNSnujSkfGgh4Z+/2Hc8u004T8Kh++5unU\n'
    + '8UL5mw65bSRYxVNpv/0OLqw5xnOMPRnmPZKAWQbTtBIEZHMULFEBwf4TMWW8Rt0q\n'
    + 'GYMzZSN7YCke5KyDYcfUwZ25HYawxKWgkYsTv2wnJScCaCpcW8GXYLYnWzkXBDKg\n'
    + 'FXHG28qNAjSTxnHaGCzxJLwdPpPucYP/tuKA5BNK+A8KtK131y5StVK94V4396Xc\n'
    + '40P0DgPVxC7QgBStdyHKinjU02NXPWuEPPpDBZlURR98/5PnC/47awYsDLbjKcUC\n'
    + 'khTxKeMA2bSukvsdCXqIZBRuGLaoTWLB9MpHuPCWVLEPNl21NSqPkt20W22oxWBx\n'
    + 'Gy1HeUyIEJMrQIdjWLesO04vNwW8U+Nm5vBgegTUtVPPOOTxoZCUCX8uYwmaNX8=\n'
    + '-----END CERTIFICATE-----\n';

  const tmpCaFile = path.join(__dirname, 'scratch', `alternate_ca_${process.pid}.pem`);
  fs.mkdirSync(path.dirname(tmpCaFile), { recursive: true });
  fs.writeFileSync(tmpCaFile, alternateCaPem);

  try {
    const rFp = expectError(() => validateTargetConfiguration({
      target: 'staging',
      dbUrl: validStagingUrl,
      env: { DATABASE_SSL_CA_FILE: tmpCaFile }
    }));
    check('RT-15b', rFp.threw && rFp.code === 'DATABASE_TLS_FINGERPRINT_MISMATCH', 'mismatched CA fingerprint fails closed with DATABASE_TLS_FINGERPRINT_MISMATCH');
  } finally {
    if (fs.existsSync(tmpCaFile)) fs.unlinkSync(tmpCaFile);
  }
}

// -------------------------------------------------------------------------
// SECTION 5: IN-BAND DATABASE SESSION & MIGRATION BASELINE VERIFICATION
// -------------------------------------------------------------------------
async function runAsyncTests() {
  // Test 16: Wrong database identity
  const mockWrongDb = {
    query: async (sql) => {
      if (sql.includes('current_database')) {
        return { rows: [{ db: 'rogue_db', usr: `postgres.${SANCTIONED_STAGING_REF}`, ip: '10.0.0.1' }] };
      }
      return { rows: [] };
    }
  };
  const r16 = await expectAsyncError(() => verifyInBandDatabaseIdentity({ client: mockWrongDb, target: 'staging' }));
  check('RT-16', r16.threw && r16.code === 'DATABASE_IDENTITY_MISMATCH', 'in-band catalog database mismatch throws DATABASE_IDENTITY_MISMATCH');

  // Test 17: Wrong user identity on staging
  const mockWrongUser = {
    query: async (sql) => {
      if (sql.includes('current_database')) {
        return { rows: [{ db: 'postgres', usr: 'some_other_tenant', ip: '10.0.0.1' }] };
      }
      return { rows: [] };
    }
  };
  const r17 = await expectAsyncError(() => verifyInBandDatabaseIdentity({ client: mockWrongUser, target: 'staging' }));
  check('RT-17', r17.threw && r17.code === 'DATABASE_USER_MISMATCH', 'in-band catalog user mismatch throws DATABASE_USER_MISMATCH');

  // Test 18: Missing Migration 039 baseline
  const mockMissing039 = {
    query: async (sql) => {
      if (sql.includes('current_database')) {
        return { rows: [{ db: 'postgres', usr: `postgres.${SANCTIONED_STAGING_REF}`, ip: '10.0.0.1' }] };
      }
      if (sql.includes('schema_migrations')) {
        return { rows: [] }; // 039 not found
      }
      return { rows: [] };
    }
  };
  const r18 = await expectAsyncError(() => verifyInBandDatabaseIdentity({ client: mockMissing039, target: 'staging' }));
  check('RT-18', r18.threw && r18.code === 'BASELINE_MIGRATION_MISSING', 'missing Migration 039 throws BASELINE_MIGRATION_MISSING');

  // Test 19: Valid in-band attestation
  const mockValid = {
    query: async (sql) => {
      if (sql.includes('current_database')) {
        return { rows: [{ db: 'postgres', usr: `postgres.${SANCTIONED_STAGING_REF}`, ip: '10.0.0.1' }] };
      }
      if (sql.includes('schema_migrations')) {
        return { rows: [{ version: '039', name: '039_atomic_double_entry_capture_and_refund' }] };
      }
      return { rows: [] };
    }
  };
  const r19 = await verifyInBandDatabaseIdentity({ client: mockValid, target: 'staging' });
  check('RT-19', r19.verified === true && r19.migration039Active === true, 'in-band verification succeeds with database, user, and Migration 039 confirmed');

  // -------------------------------------------------------------------------
  // SECTION 6: DRY-RUN TRANSACTION ISOLATION SQL
  // -------------------------------------------------------------------------
  check('RT-20', getDryRunTransactionSql() === 'BEGIN TRANSACTION READ ONLY;', 'getDryRunTransactionSql produces READ ONLY transaction SQL');
  check('RT-21', getDryRunRollbackSql() === 'ROLLBACK;', 'getDryRunRollbackSql produces ROLLBACK SQL');

  // -------------------------------------------------------------------------
  // SECTION 7: DETERMINISTIC MANIFEST HASHING & ALL ACCOUNTING FIELDS
  // -------------------------------------------------------------------------
  const sampleCandidateA = {
    entry_id: 'ENT_001',
    reference_id: 'REF_001',
    category: 'DISPUTE_REFUND',
    amount: 500,
    debit_account: 'CUSTOMER_WALLET_LIABILITY',
    credit_account: 'PAYMENT_GATEWAY_ESCROW',
    created_at: '2026-10-12T12:00:00Z',
    job_id: 'JOB_101',
    currency: 'INR'
  };

  const sampleCandidateB = {
    entry_id: 'ENT_002',
    reference_id: 'REF_002',
    category: 'PAYMENT_CAPTURE',
    amount: 1000,
    debit_account: 'PAYMENT_GATEWAY_ESCROW',
    credit_account: 'MERCHANT_PAYABLE',
    created_at: '2026-10-12T12:05:00Z',
    job_id: 'JOB_102',
    currency: 'INR'
  };

  const sampleReport = {
    target: 'staging',
    projectRef: SANCTIONED_STAGING_REF,
    baselineVersion: '039',
    candidateCount: 2,
    totalDebit: 1500,
    totalCredit: 1500,
    quarantinedCount: 0,
    candidateEntries: [sampleCandidateA, sampleCandidateB]
  };

  const digest1 = computeReportManifest(sampleReport);
  check('RT-22', typeof digest1 === 'string' && digest1.length === 64, 'computeReportManifest produces 64-char SHA-256 digest');

  // Array order invariance
  const sampleReportReversed = {
    ...sampleReport,
    candidateEntries: [sampleCandidateB, sampleCandidateA]
  };
  check('RT-23', digest1 === computeReportManifest(sampleReportReversed), 'manifest computation is deterministic and independent of input array order');

  // Sensitivity to every accounting-relevant field
  const dRef = computeReportManifest({ ...sampleReport, candidateEntries: [{ ...sampleCandidateA, reference_id: 'REF_CHANGED' }, sampleCandidateB] });
  check('RT-23b', dRef !== digest1, 'altering reference_id changes manifest digest');

  const dCat = computeReportManifest({ ...sampleReport, candidateEntries: [{ ...sampleCandidateA, category: 'GENERAL_LEDGER' }, sampleCandidateB] });
  check('RT-23c', dCat !== digest1, 'altering category changes manifest digest');

  const dDebitAcc = computeReportManifest({ ...sampleReport, candidateEntries: [{ ...sampleCandidateA, debit_account: 'MERCHANT_PAYABLE' }, sampleCandidateB] });
  check('RT-23d', dDebitAcc !== digest1, 'altering debit_account changes manifest digest');

  const dCreditAcc = computeReportManifest({ ...sampleReport, candidateEntries: [{ ...sampleCandidateA, credit_account: 'CUSTOMER_WALLET_LIABILITY' }, sampleCandidateB] });
  check('RT-23e', dCreditAcc !== digest1, 'altering credit_account changes manifest digest');

  const dCreatedAt = computeReportManifest({ ...sampleReport, candidateEntries: [{ ...sampleCandidateA, created_at: '2026-10-12T13:00:00Z' }, sampleCandidateB] });
  check('RT-23f', dCreatedAt !== digest1, 'altering created_at changes manifest digest');

  const dJobId = computeReportManifest({ ...sampleReport, candidateEntries: [{ ...sampleCandidateA, job_id: 'JOB_999' }, sampleCandidateB] });
  check('RT-23g', dJobId !== digest1, 'altering job_id changes manifest digest');

  const dCurrency = computeReportManifest({ ...sampleReport, candidateEntries: [{ ...sampleCandidateA, currency: 'USD' }, sampleCandidateB] });
  check('RT-23h', dCurrency !== digest1, 'altering currency changes manifest digest');

  // -------------------------------------------------------------------------
  // SECTION 8: MANDATORY APPROVAL EXPIRATION & ISSUANCE WINDOW
  // -------------------------------------------------------------------------
  const now = 1791854630000;
  const testKeyPair = crypto.generateKeyPairSync('ed25519');
  const trustedPubKey = testKeyPair.publicKey;
  const ownerPrivateKey = testKeyPair.privateKey;
  const ownerIdentity = 'Platform Owner <owner@nabin.in>';
  const testNonce = 'nonce_abc12345678';

  const baseApproval = {
    approvalStatus: 'APPROVED',
    approvedBy: ownerIdentity,
    target: 'staging',
    projectRef: SANCTIONED_STAGING_REF,
    operation: REQUIRED_OPERATION_NAME,
    manifestDigest: digest1,
    candidateCount: 2,
    totalAmount: 1500,
    issuedAtMs: now,
    expiresAtMs: now + 1800000, // 30m TTL
    nonce: testNonce
  };
  baseApproval.signature = signApprovalPayloadForTesting({ artifact: baseApproval, privateKey: ownerPrivateKey });

  // Missing expiration
  const rExpMissing = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, expiresAtMs: undefined },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24a', rExpMissing.threw && rExpMissing.code === 'APPROVAL_EXPIRATION_MISSING', 'missing expiresAtMs throws APPROVAL_EXPIRATION_MISSING');

  // Non-numeric expiration
  const rExpNaN = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, expiresAtMs: 'never' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24b', rExpNaN.threw && rExpNaN.code === 'APPROVAL_EXPIRATION_MISSING', 'non-numeric expiresAtMs throws APPROVAL_EXPIRATION_MISSING');

  // Missing issuedAtMs
  const rIssuedMissing = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, issuedAtMs: null },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24c', rIssuedMissing.threw && rIssuedMissing.code === 'APPROVAL_ISSUED_AT_MISSING', 'missing issuedAtMs throws APPROVAL_ISSUED_AT_MISSING');

  // Future-issued approval
  const rFuture = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, issuedAtMs: now + 120000 },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24d', rFuture.threw && rFuture.code === 'APPROVAL_FUTURE_ISSUED', 'future-issued approval throws APPROVAL_FUTURE_ISSUED');

  // Expiration before issuance
  const rWindowInv = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, issuedAtMs: now, expiresAtMs: now - 100 },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24e', rWindowInv.threw && rWindowInv.code === 'APPROVAL_WINDOW_INVALID', 'expiresAtMs <= issuedAtMs throws APPROVAL_WINDOW_INVALID');

  // Excessive TTL (> 60m)
  const rTtlMax = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, issuedAtMs: now, expiresAtMs: now + (61 * 60 * 1000) },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24f', rTtlMax.threw && rTtlMax.code === 'APPROVAL_LIFETIME_EXCESSIVE', 'approval TTL > 60m throws APPROVAL_LIFETIME_EXCESSIVE');

  // Expired approval (past expiration)
  const rExpired = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: baseApproval,
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now + 1800001,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24g', rExpired.threw && rExpired.code === 'APPROVAL_WINDOW_EXPIRED', 'expired approval artifact (past expiration) throws APPROVAL_WINDOW_EXPIRED');

  // Expired approval (exact boundary: currentTimestampMs === expiresAtMs)
  const rExactBoundary = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: baseApproval,
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now + 1800000,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-24h', rExactBoundary.threw && rExactBoundary.code === 'APPROVAL_WINDOW_EXPIRED', 'approval evaluated at exact expiration millisecond throws APPROVAL_WINDOW_EXPIRED');

  // Delimiter injection in field
  const rDelimiterInj = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, approvedBy: 'Platform Owner|injected_flag' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: 'Platform Owner|injected_flag'
  }));
  check('RT-24i', rDelimiterInj.threw && rDelimiterInj.code === 'APPROVAL_FIELD_DELIMITER_INJECTION', 'delimiter injection with pipe character throws APPROVAL_FIELD_DELIMITER_INJECTION');

  // -------------------------------------------------------------------------
  // SECTION 9: EXACT TARGET, PROJECT REF, OPERATION & BOUNDS BINDING
  // -------------------------------------------------------------------------
  // Target mismatch
  const rTgtMismatch = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, target: 'local' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-25a', rTgtMismatch.threw && rTgtMismatch.code === 'APPROVAL_TARGET_MISMATCH', 'target mismatch throws APPROVAL_TARGET_MISMATCH');

  // Staging project ref mismatch
  const rRefMismatch = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, projectRef: 'other_ref_12345' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-25b', rRefMismatch.threw && rRefMismatch.code === 'APPROVAL_PROJECT_REF_MISMATCH', 'project ref mismatch throws APPROVAL_PROJECT_REF_MISMATCH');

  // Operation name mismatch
  const rOpMismatch = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, operation: 'ARBITRARY_MUTATION' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-25c', rOpMismatch.threw && rOpMismatch.code === 'OPERATION_NAME_MISMATCH', 'unapproved operation name throws OPERATION_NAME_MISMATCH');

  // Candidate count mismatch
  const rCountMismatch = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, candidateCount: 99 },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-25d', rCountMismatch.threw && rCountMismatch.code === 'APPROVAL_BOUNDS_MISMATCH', 'candidateCount mismatch throws APPROVAL_BOUNDS_MISMATCH');

  // Total amount mismatch
  const rAmtMismatch = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, totalAmount: 9999 },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-25e', rAmtMismatch.threw && rAmtMismatch.code === 'APPROVAL_BOUNDS_MISMATCH', 'totalAmount mismatch throws APPROVAL_BOUNDS_MISMATCH');

  // -------------------------------------------------------------------------
  // SECTION 10: REPLAY PROTECTION & UNIQUE NONCE HANDLING
  // -------------------------------------------------------------------------
  const rNonceMissing = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, nonce: 'short' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-26a', rNonceMissing.threw && rNonceMissing.code === 'APPROVAL_NONCE_INVALID', 'invalid/short nonce throws APPROVAL_NONCE_INVALID');

  const consumedSet = new Set(['consumed_nonce_9999']);
  const rNonceReplayed = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, nonce: 'consumed_nonce_9999' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity,
    consumedNonces: consumedSet
  }));
  check('RT-26b', rNonceReplayed.threw && rNonceReplayed.code === 'APPROVAL_NONCE_REPLAYED', 'replayed nonce throws APPROVAL_NONCE_REPLAYED');

  // -------------------------------------------------------------------------
  // SECTION 11: CRYPTOGRAPHIC DIGITAL SIGNATURE (Ed25519)
  // -------------------------------------------------------------------------
  // Unconfigured owner public key
  const rNoKey = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: baseApproval,
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: null
  }));
  check('RT-27a', rNoKey.threw && rNoKey.code === 'OWNER_PUBLIC_KEY_UNCONFIGURED', 'unconfigured owner public key fails closed with OWNER_PUBLIC_KEY_UNCONFIGURED');

  // Owner identity mismatch
  const rOwnerMismatch = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: baseApproval,
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: 'Different Owner'
  }));
  check('RT-27b', rOwnerMismatch.threw && rOwnerMismatch.code === 'APPROVAL_OWNER_IDENTITY_MISMATCH', 'owner identity mismatch throws APPROVAL_OWNER_IDENTITY_MISMATCH');

  // Missing signature
  const rSigMissing = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, signature: '' },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-27c', rSigMissing.threw && rSigMissing.code === 'APPROVAL_SIGNATURE_MISSING', 'missing signature throws APPROVAL_SIGNATURE_MISSING');

  // Forged signature
  const rSigForged = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: { ...baseApproval, signature: 'deadbeef'.repeat(16) },
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity
  }));
  check('RT-27d', rSigForged.threw && rSigForged.code === 'APPROVAL_SIGNATURE_INVALID', 'forged signature throws APPROVAL_SIGNATURE_INVALID');

  // Fully verified approval with valid Ed25519 signature
  const freshNonce = 'fresh_nonce_' + Date.now();
  const validApproval = { ...baseApproval, nonce: freshNonce };
  validApproval.signature = signApprovalPayloadForTesting({ artifact: validApproval, privateKey: ownerPrivateKey });

  const authResult = validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: validApproval,
    liveCandidateSet: sampleReport.candidateEntries,
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity,
    consumedNonces: consumedSet
  });
  check('RT-27e', authResult.authorized === true && consumedSet.has(freshNonce), 'valid Ed25519 signature authorizes execution and consumes nonce');

  // -------------------------------------------------------------------------
  // SECTION 12: FULL-TUPLE CANDIDATE SET DRIFT DETECTION
  // -------------------------------------------------------------------------
  function testDrift(alteredCandidate, label, testId) {
    const alteredLiveSet = [sampleCandidateA, alteredCandidate];
    const r = expectError(() => validateBackfillExecutionAuthorization({
      dryRunReport: sampleReport,
      approvalArtifact: validApproval,
      liveCandidateSet: alteredLiveSet,
      currentTimestampMs: now,
      trustedPublicKey: trustedPubKey,
      expectedOwnerIdentity: ownerIdentity,
      consumedNonces: new Set()
    }));
    check(testId, r.threw && r.code === 'CANDIDATE_SET_DRIFT_DETECTED' && r.err.message.includes(label), `drift in ${label} detected and rejected`);
  }

  testDrift({ ...sampleCandidateB, amount: 999 }, 'amount', 'RT-28a');
  testDrift({ ...sampleCandidateB, debit_account: 'CUSTOMER_WALLET_LIABILITY' }, 'debit_account', 'RT-28b');
  testDrift({ ...sampleCandidateB, credit_account: 'CUSTOMER_WALLET_LIABILITY' }, 'credit_account', 'RT-28c');
  testDrift({ ...sampleCandidateB, category: 'DISPUTE_REFUND' }, 'category', 'RT-28d');
  testDrift({ ...sampleCandidateB, reference_id: 'REF_ALTERED' }, 'reference_id', 'RT-28e');
  testDrift({ ...sampleCandidateB, created_at: '2026-10-12T19:00:00Z' }, 'created_at', 'RT-28f');
  testDrift({ ...sampleCandidateB, job_id: 'JOB_ALTERED' }, 'job_id', 'RT-28g');
  testDrift({ ...sampleCandidateB, currency: 'EUR' }, 'currency', 'RT-28h');

  // Candidate count drift (extra candidate)
  const rExtra = expectError(() => validateBackfillExecutionAuthorization({
    dryRunReport: sampleReport,
    approvalArtifact: validApproval,
    liveCandidateSet: [...sampleReport.candidateEntries, { entry_id: 'ENT_003', amount: 100 }],
    currentTimestampMs: now,
    trustedPublicKey: trustedPubKey,
    expectedOwnerIdentity: ownerIdentity,
    consumedNonces: new Set()
  }));
  check('RT-28i', rExtra.threw && rExtra.code === 'CANDIDATE_SET_DRIFT_DETECTED', 'extra candidate in live set throws CANDIDATE_SET_DRIFT_DETECTED');

  console.log('\n========================================================================');
  const total = checks.length;
  const passed = checks.filter((c) => c.ok).length;
  const failed = total - passed;
  console.log(`📊 RECONCILER TARGET GUARD: ${passed} PASSED, ${failed} FAILED (Total: ${total})`);
  console.log('========================================================================');

  if (failed > 0) process.exit(1);
}

runAsyncTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
