/**
 * NABIN — Offline Adversarial Reconciler Integration Test Harness
 *
 * Verifies end-to-end integration guarantees against local Docker PostgreSQL:
 * 1. Transaction-scoped advisory locking (pg_try_advisory_xact_lock)
 * 2. Durable database-backed nonce replay protection (reconciliation_audit_nonces)
 * 3. Atomic journal writes and complete rollback on constraint failure
 * 4. Explicit idempotency conflict classification (exact match vs unexpected collision)
 * 5. Full-tuple candidate set zero drift detection
 * 6. Ed25519 cryptographic signature authorization gate
 * 7. Expiration boundary enforcement (max 60m TTL)
 * 8. Target pre-flight and pinned TLS defense-in-depth
 * 9. Ambiguous commit outcome verification and manual review stop
 *
 * Safety:
 * - Uses isolated synthetic fixtures with prefix 'TEST_HARNESS_'
 * - Cleans up all synthetic artifacts
 * - Zero external/network I/O
 * - Local Docker loopback only
 */

'use strict';

const { Client } = require('pg');
const crypto = require('crypto');
const reconcilerSecurity = require('./src/services/reconcilerSecurity');
const {
  runDryRunScan,
  executeAuthorizedBackfill,
  verifyAmbiguousCommitOutcome,
  safeMoneyEquals
} = require('./scripts/reconcile_double_entry_ledger');

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Ensure strictly loopback
const parsedUrl = new URL(dbUrl);
if (!reconcilerSecurity.LOCAL_HOST_PATTERN && !/^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1)$/i.test(parsedUrl.hostname)) {
  console.error('❌ SAFETY REFUSAL: Non-loopback database target.');
  process.exit(1);
}

const tests = [];
function test(id, description, fn) {
  tests.push({ id, description, fn });
}

// Generate ephemeral in-memory test keypair (NEVER saved to disk)
const { publicKey: testPublicKey, privateKey: testPrivateKey } = crypto.generateKeyPairSync('ed25519');
const testPublicKeyBase64 = testPublicKey.export({ type: 'spki', format: 'der' }).toString('base64');

async function runHarness() {
  console.log('========================================================================');
  console.log('NABIN OFFLINE ADVERSARIAL RECONCILER INTEGRATION TEST HARNESS');
  console.log(`Database Target: ${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port || 5432}`);
  console.log('========================================================================\n');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  let passed = 0;
  let failed = 0;

  try {
    // -------------------------------------------------------------------------
    // INT-01: Transaction-Scoped Advisory Lock Prevents Concurrent Backfill
    // -------------------------------------------------------------------------
    test('INT-01', 'Transaction-scoped advisory lock prevents concurrent execution', async () => {
      const client2 = new Client({ connectionString: dbUrl });
      await client2.connect();

      await client.query('BEGIN');
      const lock1 = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('nabin_reconciliation_backfill_lock')) AS acquired;");
      if (!lock1.rows[0].acquired) throw new Error('Client 1 failed to acquire lock');

      // Client 2 attempts to acquire lock concurrently: pg_try_advisory_xact_lock is non-blocking and returns false immediately
      await client2.query('BEGIN');
      const startTime = Date.now();
      const lock2 = await client2.query("SELECT pg_try_advisory_xact_lock(hashtext('nabin_reconciliation_backfill_lock')) AS acquired;");
      const elapsedMs = Date.now() - startTime;
      
      const client2Blocked = lock2.rows[0].acquired === false;

      await client2.query('ROLLBACK');
      await client2.end();
      await client.query('ROLLBACK');

      if (!client2Blocked) throw new Error('Client 2 should have been refused advisory lock');
      if (elapsedMs > 500) throw new Error(`pg_try_advisory_xact_lock waited ${elapsedMs}ms instead of returning false immediately`);
      return { client1Acquired: true, client2Blocked: true, nonBlockingDurationMs: elapsedMs };
    });

    // -------------------------------------------------------------------------
    // INT-02: Durable Nonce Replay Protection in Database
    // -------------------------------------------------------------------------
    test('INT-02', 'Durable database-backed nonce replay throws unique constraint violation', async () => {
      const nonce = 'TEST_NONCE_DURABLE_' + Date.now();
      const digest = crypto.createHash('sha256').update('test').digest('hex');

      // First insertion
      await client.query(`
        INSERT INTO reconciliation_audit_nonces (
          nonce, manifest_digest, target, project_ref, operation, approved_by,
          candidate_count, total_amount, issued_at, expires_at, consumed_by_pid, status
        ) VALUES ($1, $2, 'local', 'local', 'FINANCIAL_LEDGER_BACKFILL_EXECUTE', 'owner_test', 1, 100.00, NOW(), NOW() + interval '10 min', $3, 'COMMITTED');
      `, [nonce, digest, process.pid]);

      // Second insertion with identical nonce must fail closed with 23505
      let caught = null;
      try {
        await client.query(`
          INSERT INTO reconciliation_audit_nonces (
            nonce, manifest_digest, target, project_ref, operation, approved_by,
            candidate_count, total_amount, issued_at, expires_at, consumed_by_pid, status
          ) VALUES ($1, $2, 'local', 'local', 'FINANCIAL_LEDGER_BACKFILL_EXECUTE', 'owner_test', 1, 100.00, NOW(), NOW() + interval '10 min', $3, 'COMMITTED');
        `, [nonce, digest, process.pid]);
      } catch (err) {
        caught = err;
      }

      // Cleanup test nonce
      await client.query('DELETE FROM reconciliation_audit_nonces WHERE nonce = $1;', [nonce]);

      if (!caught || caught.code !== '23505') {
        throw new Error(`Expected PostgreSQL unique violation 23505, got: ${caught ? caught.message : 'none'}`);
      }
      return { caught23505: true, constraint: caught.constraint };
    });

    // -------------------------------------------------------------------------
    // INT-03: Replay of Already-Consumed Nonce in Memory & Approval Gate
    // -------------------------------------------------------------------------
    test('INT-03', 'Approval validator rejects already-consumed nonce in memory', async () => {
      const report = { target: 'local', candidateCount: 0, totalDebit: 0, quarantinedCount: 0, candidateEntries: [] };
      const digest = reconcilerSecurity.computeReportManifest(report);
      const consumedNonces = new Set(['CONSUMED_NONCE_12345']);
      const artifact = {
        approvalStatus: 'APPROVED',
        approvedBy: 'platform_owner',
        target: 'local',
        projectRef: '',
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        manifestDigest: digest,
        candidateCount: 0,
        totalAmount: 0,
        issuedAtMs: Date.now() - 1000,
        expiresAtMs: Date.now() + 100000,
        nonce: 'CONSUMED_NONCE_12345',
        signature: 'deadbeef'
      };

      let caught = null;
      try {
        reconcilerSecurity.validateBackfillExecutionAuthorization({
          dryRunReport: report,
          approvalArtifact: artifact,
          liveCandidateSet: [],
          currentTimestampMs: Date.now(),
          trustedPublicKey: testPublicKey,
          consumedNonces
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'APPROVAL_NONCE_REPLAYED') {
        throw new Error(`Expected APPROVAL_NONCE_REPLAYED, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtReplay: true };
    });

    // -------------------------------------------------------------------------
    // INT-04: Dry-Run Scan is Zero-Mutation
    // -------------------------------------------------------------------------
    test('INT-04', 'Engine-level read-only dry-run scan causes zero database mutations', async () => {
      const preCount = (await client.query('SELECT count(*)::int AS count FROM journal_transactions')).rows[0].count;
      const report = await runDryRunScan({ client, target: 'local' });
      const postCount = (await client.query('SELECT count(*)::int AS count FROM journal_transactions')).rows[0].count;

      if (preCount !== postCount) {
        throw new Error(`Dry run altered journal_transactions count: pre=${preCount}, post=${postCount}`);
      }
      if (!report.manifestDigest || report.manifestDigest.length !== 64) {
        throw new Error('Dry run failed to generate 64-char hex manifest digest');
      }
      return { preCount, postCount, manifestDigest: report.manifestDigest };
    });

    // -------------------------------------------------------------------------
    // INT-05: Atomic Rollback on Constraint Violation During Backfill
    // -------------------------------------------------------------------------
    test('INT-05', 'Constraint violation during backfill rolls back nonces and journals atomically', async () => {
      const testNonce = 'TEST_FAIL_ROLLBACK_' + Date.now();
      const syntheticFaultyCandidate = {
        source_id: '00000000-0000-0000-0000-000000000001',
        source_entry_id: 'TEST_SYNTH_ERR_01',
        entry_id: 'TEST_SYNTH_ERR_01',
        job_id: null,
        transaction_id: 'txn_synth_err_' + Date.now(),
        idempotency_key: 'recon_synth_err_' + Date.now(),
        category: 'PAYMENT_CAPTURE',
        total_debit: 50.00,
        total_credit: 50.00,
        amount: 50.00,
        debit_account: 'PAYMENT_GATEWAY_ESCROW',
        credit_account: 'INVALID_NONEXISTENT_ACCOUNT', // triggers FK failure or integrity check
        currency: 'INR',
        reference_id: 'ref_synth_err_01',
        description: 'Test faulty candidate',
        created_at: new Date().toISOString(),
        lines: [
          { account_code: 'PAYMENT_GATEWAY_ESCROW', entry_type: 'DEBIT', amount: 50.00, entity_type: 'GATEWAY', notes: 'line 1' },
          { account_code: 'INVALID_NONEXISTENT_ACCOUNT', entry_type: 'CREDIT', amount: 50.00, entity_type: 'CUSTOMER', notes: 'line 2' }
        ]
      };

      const approvalArtifact = {
        nonce: testNonce,
        manifestDigest: 'test_faulty_digest',
        target: 'local',
        projectRef: '',
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        approvedBy: 'platform_owner',
        candidateCount: 1,
        totalAmount: 50.00,
        issuedAtMs: Date.now() - 1000,
        expiresAtMs: Date.now() + 60000
      };

      let caught = null;
      try {
        await executeAuthorizedBackfill({
          client,
          target: 'local',
          approvalArtifact,
          dryRunReport: { candidateCount: 1, totalDebit: 50.00 },
          proposed: [syntheticFaultyCandidate]
        });
      } catch (err) {
        caught = err;
      }

      // Verify that neither nonce nor journal transaction was committed
      const nonceCheck = await client.query('SELECT count(*)::int as count FROM reconciliation_audit_nonces WHERE nonce = $1', [testNonce]);
      const journalCheck = await client.query('SELECT count(*)::int as count FROM journal_transactions WHERE transaction_id = $1', [syntheticFaultyCandidate.transaction_id]);

      if (nonceCheck.rows[0].count !== 0 || journalCheck.rows[0].count !== 0) {
        throw new Error(`Rollback failed! Left stray rows: nonce=${nonceCheck.rows[0].count}, journal=${journalCheck.rows[0].count}`);
      }
      return { caught: caught ? caught.code || caught.message : 'none', nonceRows: 0, journalRows: 0 };
    });

    // -------------------------------------------------------------------------
    // INT-06: Candidate Set Drift Detection (Altered Amount)
    // -------------------------------------------------------------------------
    test('INT-06', 'Live candidate drift (altered amount) is detected and refused', async () => {
      const reviewed = [
        { entry_id: 'LE_001', amount: 100.00, debit_account: 'A', credit_account: 'B', category: 'C', reference_id: 'R', created_at: 'T', job_id: 'J', currency: 'INR' }
      ];
      const live = [
        { entry_id: 'LE_001', amount: 150.00, debit_account: 'A', credit_account: 'B', category: 'C', reference_id: 'R', created_at: 'T', job_id: 'J', currency: 'INR' }
      ];

      const report = {
        target: 'local',
        baselineVersion: '039',
        candidateCount: 1,
        totalDebit: 100.00,
        totalCredit: 100.00,
        quarantinedCount: 0,
        candidateEntries: reviewed
      };
      const digest = reconcilerSecurity.computeReportManifest(report);

      const artifact = {
        approvalStatus: 'APPROVED',
        approvedBy: 'owner',
        target: 'local',
        projectRef: '',
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        manifestDigest: digest,
        candidateCount: 1,
        totalAmount: 100.00,
        issuedAtMs: Date.now() - 1000,
        expiresAtMs: Date.now() + 60000,
        nonce: 'NONCE_DRIFT_01',
        signature: ''
      };
      artifact.signature = reconcilerSecurity.signApprovalPayloadForTesting({ artifact, privateKey: testPrivateKey });

      let caught = null;
      try {
        reconcilerSecurity.validateBackfillExecutionAuthorization({
          dryRunReport: report,
          approvalArtifact: artifact,
          liveCandidateSet: live,
          trustedPublicKey: testPublicKey
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'CANDIDATE_SET_DRIFT_DETECTED') {
        throw new Error(`Expected CANDIDATE_SET_DRIFT_DETECTED, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtDrift: true, error: caught.message };
    });

    // -------------------------------------------------------------------------
    // INT-07: Candidate Set Drift Detection (Altered Debit Account)
    // -------------------------------------------------------------------------
    test('INT-07', 'Live candidate drift (altered debit account) is detected and refused', async () => {
      const reviewed = [
        { entry_id: 'LE_002', amount: 50.00, debit_account: 'ACCOUNT_ORIG', credit_account: 'B', category: 'C', reference_id: 'R', created_at: 'T', job_id: 'J', currency: 'INR' }
      ];
      const live = [
        { entry_id: 'LE_002', amount: 50.00, debit_account: 'ACCOUNT_DRIFT', credit_account: 'B', category: 'C', reference_id: 'R', created_at: 'T', job_id: 'J', currency: 'INR' }
      ];

      const report = {
        target: 'local',
        baselineVersion: '039',
        candidateCount: 1,
        totalDebit: 50.00,
        totalCredit: 50.00,
        quarantinedCount: 0,
        candidateEntries: reviewed
      };
      const digest = reconcilerSecurity.computeReportManifest(report);

      const artifact = {
        approvalStatus: 'APPROVED',
        approvedBy: 'owner',
        target: 'local',
        projectRef: '',
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        manifestDigest: digest,
        candidateCount: 1,
        totalAmount: 50.00,
        issuedAtMs: Date.now() - 1000,
        expiresAtMs: Date.now() + 60000,
        nonce: 'NONCE_DRIFT_02',
        signature: ''
      };
      artifact.signature = reconcilerSecurity.signApprovalPayloadForTesting({ artifact, privateKey: testPrivateKey });

      let caught = null;
      try {
        reconcilerSecurity.validateBackfillExecutionAuthorization({
          dryRunReport: report,
          approvalArtifact: artifact,
          liveCandidateSet: live,
          trustedPublicKey: testPublicKey
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'CANDIDATE_SET_DRIFT_DETECTED') {
        throw new Error(`Expected CANDIDATE_SET_DRIFT_DETECTED, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtDrift: true, error: caught.message };
    });

    // -------------------------------------------------------------------------
    // INT-08: Candidate Set Drift Detection (Candidate Count Mismatch)
    // -------------------------------------------------------------------------
    test('INT-08', 'Candidate count divergence between report and live scan is refused', async () => {
      const reviewed = [
        { entry_id: 'LE_003', amount: 75.00, debit_account: 'A', credit_account: 'B', category: 'C', reference_id: 'R', created_at: 'T', job_id: 'J', currency: 'INR' }
      ];
      const live = [
        { entry_id: 'LE_003', amount: 75.00, debit_account: 'A', credit_account: 'B', category: 'C', reference_id: 'R', created_at: 'T', job_id: 'J', currency: 'INR' },
        { entry_id: 'LE_004', amount: 25.00, debit_account: 'A', credit_account: 'B', category: 'C', reference_id: 'R', created_at: 'T', job_id: 'J', currency: 'INR' }
      ];

      const report = {
        target: 'local',
        baselineVersion: '039',
        candidateCount: 1,
        totalDebit: 75.00,
        totalCredit: 75.00,
        quarantinedCount: 0,
        candidateEntries: reviewed
      };
      const digest = reconcilerSecurity.computeReportManifest(report);

      const artifact = {
        approvalStatus: 'APPROVED',
        approvedBy: 'owner',
        target: 'local',
        projectRef: '',
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        manifestDigest: digest,
        candidateCount: 1,
        totalAmount: 75.00,
        issuedAtMs: Date.now() - 1000,
        expiresAtMs: Date.now() + 60000,
        nonce: 'NONCE_DRIFT_COUNT',
        signature: ''
      };
      artifact.signature = reconcilerSecurity.signApprovalPayloadForTesting({ artifact, privateKey: testPrivateKey });

      let caught = null;
      try {
        reconcilerSecurity.validateBackfillExecutionAuthorization({
          dryRunReport: report,
          approvalArtifact: artifact,
          liveCandidateSet: live,
          trustedPublicKey: testPublicKey
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'CANDIDATE_SET_DRIFT_DETECTED') {
        throw new Error(`Expected CANDIDATE_SET_DRIFT_DETECTED, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtDrift: true };
    });

    // -------------------------------------------------------------------------
    // INT-09: Expiration Boundary Enforcement
    // -------------------------------------------------------------------------
    test('INT-09', 'Approval artifact evaluated exactly at or after expiresAtMs is refused', async () => {
      const now = Date.now();
      const report = { target: 'local', candidateCount: 0, totalDebit: 0, quarantinedCount: 0, candidateEntries: [] };
      const digest = reconcilerSecurity.computeReportManifest(report);

      const artifact = {
        approvalStatus: 'APPROVED',
        approvedBy: 'owner',
        target: 'local',
        projectRef: '',
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        manifestDigest: digest,
        candidateCount: 0,
        totalAmount: 0.00,
        issuedAtMs: now - 3600000,
        expiresAtMs: now, // exact boundary: now >= expiresAtMs
        nonce: 'NONCE_EXPIRED_01',
        signature: ''
      };
      artifact.signature = reconcilerSecurity.signApprovalPayloadForTesting({ artifact, privateKey: testPrivateKey });

      let caught = null;
      try {
        reconcilerSecurity.validateBackfillExecutionAuthorization({
          dryRunReport: report,
          approvalArtifact: artifact,
          liveCandidateSet: [],
          currentTimestampMs: now,
          trustedPublicKey: testPublicKey
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'APPROVAL_WINDOW_EXPIRED') {
        throw new Error(`Expected APPROVAL_WINDOW_EXPIRED, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtExpired: true };
    });

    // -------------------------------------------------------------------------
    // INT-10: Cryptographic Signature Verification
    // -------------------------------------------------------------------------
    test('INT-10', 'Tampered canonical payload or forged signature is rejected', async () => {
      const now = Date.now();
      const report = { target: 'local', candidateCount: 0, totalDebit: 0, quarantinedCount: 0, candidateEntries: [] };
      const digest = reconcilerSecurity.computeReportManifest(report);

      const artifact = {
        approvalStatus: 'APPROVED',
        approvedBy: 'owner',
        target: 'local',
        projectRef: '',
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        manifestDigest: digest,
        candidateCount: 0,
        totalAmount: 0.00,
        issuedAtMs: now - 1000,
        expiresAtMs: now + 60000,
        nonce: 'NONCE_SIG_TEST',
        signature: ''
      };
      artifact.signature = reconcilerSecurity.signApprovalPayloadForTesting({ artifact, privateKey: testPrivateKey });

      // Tamper with approvedBy after signing
      artifact.approvedBy = 'forged_owner_attacker';

      let caught = null;
      try {
        reconcilerSecurity.validateBackfillExecutionAuthorization({
          dryRunReport: report,
          approvalArtifact: artifact,
          liveCandidateSet: [],
          currentTimestampMs: now,
          trustedPublicKey: testPublicKey
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'APPROVAL_SIGNATURE_INVALID') {
        throw new Error(`Expected APPROVAL_SIGNATURE_INVALID, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtInvalidSig: true };
    });

    // -------------------------------------------------------------------------
    // INT-11: Target Mismatch Refusal
    // -------------------------------------------------------------------------
    test('INT-11', 'Approval artifact for staging attempted against local target is refused', async () => {
      const now = Date.now();
      const report = { target: 'local', candidateCount: 0, totalDebit: 0, quarantinedCount: 0, candidateEntries: [] };
      const digest = reconcilerSecurity.computeReportManifest(report);

      const artifact = {
        approvalStatus: 'APPROVED',
        approvedBy: 'owner',
        target: 'staging', // Target mismatch!
        projectRef: reconcilerSecurity.SANCTIONED_STAGING_REF,
        operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
        manifestDigest: digest,
        candidateCount: 0,
        totalAmount: 0.00,
        issuedAtMs: now - 1000,
        expiresAtMs: now + 60000,
        nonce: 'NONCE_MISMATCH_TARGET',
        signature: ''
      };
      artifact.signature = reconcilerSecurity.signApprovalPayloadForTesting({ artifact, privateKey: testPrivateKey });

      let caught = null;
      try {
        reconcilerSecurity.validateBackfillExecutionAuthorization({
          dryRunReport: report,
          approvalArtifact: artifact,
          liveCandidateSet: [],
          currentTimestampMs: now,
          trustedPublicKey: testPublicKey
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'APPROVAL_TARGET_MISMATCH') {
        throw new Error(`Expected APPROVAL_TARGET_MISMATCH, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtMismatch: true };
    });

    // -------------------------------------------------------------------------
    // INT-12: Target Pre-Flight Prohibits Production References
    // -------------------------------------------------------------------------
    test('INT-12', 'Target configuration pre-flight rejects production references immediately', async () => {
      let caught = null;
      try {
        reconcilerSecurity.validateTargetConfiguration({
          target: 'staging',
          dbUrl: `postgresql://postgres:pass@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
          env: { NABIN_SUPABASE_REF: reconcilerSecurity.FORBIDDEN_PROD_REF }
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'PRODUCTION_TARGET_FORBIDDEN') {
        throw new Error(`Expected PRODUCTION_TARGET_FORBIDDEN, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtProdRef: true };
    });

    // -------------------------------------------------------------------------
    // INT-13: Port Allowlist Rejection
    // -------------------------------------------------------------------------
    test('INT-13', 'Staging target with unapproved port (5433) is rejected', async () => {
      let caught = null;
      try {
        reconcilerSecurity.validateTargetConfiguration({
          target: 'staging',
          dbUrl: 'postgresql://postgres.ywhxkzmbwppkdemvzlhv:validpassword123@aws-0-ap-northeast-1.pooler.supabase.com:5433/postgres',
          env: {}
        });
      } catch (err) {
        caught = err;
      }

      if (!caught || caught.code !== 'UNAPPROVED_STAGING_PORT') {
        throw new Error(`Expected UNAPPROVED_STAGING_PORT, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtUnapprovedPort: true };
    });

    // -------------------------------------------------------------------------
    // INT-14: Pinned TLS CA Fingerprint Enforcement
    // -------------------------------------------------------------------------
    test('INT-14', 'Mismatched CA fingerprint fails closed with DATABASE_TLS_FINGERPRINT_MISMATCH', async () => {
      const fs = require('fs');
      const path = require('path');
      const alternateCaPem = '-----BEGIN CERTIFICATE-----\n'
        + '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\n'
        + '-----END CERTIFICATE-----\n';

      const tmpCaFile = path.join(__dirname, 'scratch', `harness_alt_ca_${process.pid}.pem`);
      fs.mkdirSync(path.dirname(tmpCaFile), { recursive: true });
      fs.writeFileSync(tmpCaFile, alternateCaPem);

      let caught = null;
      try {
        reconcilerSecurity.validateTargetConfiguration({
          target: 'staging',
          dbUrl: 'postgresql://postgres.ywhxkzmbwppkdemvzlhv:validpassword123@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
          env: { DATABASE_SSL_CA_FILE: tmpCaFile }
        });
      } catch (err) {
        caught = err;
      } finally {
        if (fs.existsSync(tmpCaFile)) fs.unlinkSync(tmpCaFile);
      }

      if (!caught || caught.code !== 'DATABASE_TLS_FINGERPRINT_MISMATCH') {
        throw new Error(`Expected DATABASE_TLS_FINGERPRINT_MISMATCH, got: ${caught ? caught.code : 'none'}`);
      }
      return { caughtFingerprintMismatch: true };
    });

    // -------------------------------------------------------------------------
    // INT-15: Idempotency Conflict Classification (SEC-REC-02 Verification)
    // -------------------------------------------------------------------------
    test('INT-15', 'Explicit conflict classification verifies line-level accounts, directions, amounts, and exact duplicates', async () => {
      // Execute entire test within an outer transaction with savepoints to ensure zero persistent rows
      await client.query('BEGIN');

      let savepointCounter = 0;
      const savepointStack = [];
      const proxyClient = {
        query: async (text, params) => {
          const trimmed = typeof text === 'string' ? text.trim().toUpperCase() : '';
          if (trimmed === 'BEGIN') {
            savepointCounter++;
            const sp = `sp_backfill_${savepointCounter}`;
            savepointStack.push(sp);
            return client.query(`SAVEPOINT ${sp}`);
          }
          if (trimmed === 'COMMIT') {
            const sp = savepointStack.pop();
            return client.query(`RELEASE SAVEPOINT ${sp}`);
          }
          if (trimmed === 'ROLLBACK') {
            const sp = savepointStack.pop();
            return client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          }
          return client.query(text, params);
        }
      };

      try {
        const syntheticKey = 'recon_synth_idem_' + Date.now();
        const syntheticTxnId = 'txn_synth_idem_' + Date.now();
        const baseCandidate = {
          source_id: '00000000-0000-0000-0000-000000000002',
          source_entry_id: 'TEST_IDEM_01',
          entry_id: 'TEST_IDEM_01',
          job_id: null,
          transaction_id: syntheticTxnId,
          idempotency_key: syntheticKey,
          category: 'PAYMENT_CAPTURE',
          total_debit: 120.00,
          total_credit: 120.00,
          amount: 120.00,
          debit_account: 'PAYMENT_GATEWAY_ESCROW',
          credit_account: 'CUSTOMER_WALLET_LIABILITY',
          currency: 'INR',
          reference_id: 'ref_idem_01',
          description: 'Test idempotency candidate',
          created_at: new Date().toISOString(),
          lines: [
            { account_code: 'PAYMENT_GATEWAY_ESCROW', entry_type: 'DEBIT', amount: 120.00, entity_type: 'GATEWAY', notes: 'line 1' },
            { account_code: 'CUSTOMER_WALLET_LIABILITY', entry_type: 'CREDIT', amount: 120.00, entity_type: 'CUSTOMER', notes: 'line 2' }
          ]
        };

        const nonce1 = 'TEST_IDEM_NONCE_1_' + Date.now();
        const approvalArtifact1 = {
          nonce: nonce1,
          manifestDigest: 'digest_idem_1',
          target: 'local',
          projectRef: '',
          operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
          approvedBy: 'owner',
          candidateCount: 1,
          totalAmount: 120.00,
          issuedAtMs: Date.now() - 1000,
          expiresAtMs: Date.now() + 60000
        };

        // 1. Initial write
        const res1 = await executeAuthorizedBackfill({
          client: proxyClient,
          target: 'local',
          approvalArtifact: approvalArtifact1,
          dryRunReport: { candidateCount: 1, totalDebit: 120.00 },
          proposed: [baseCandidate]
        });

        if (res1.insertedHeaders !== 1 || res1.alreadyPostedCount !== 0) {
          throw new Error('Initial write failed to insert 1 header');
        }

        // 2. Exact match duplicate backfill run with new approval: MUST SUCCEED
        const nonce2 = 'TEST_IDEM_NONCE_2_' + Date.now();
        const approvalArtifact2 = {
          nonce: nonce2,
          manifestDigest: 'digest_idem_2',
          target: 'local',
          projectRef: '',
          operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
          approvedBy: 'owner',
          candidateCount: 1,
          totalAmount: 120.00,
          issuedAtMs: Date.now() - 1000,
          expiresAtMs: Date.now() + 60000
        };

        const res2 = await executeAuthorizedBackfill({
          client: proxyClient,
          target: 'local',
          approvalArtifact: approvalArtifact2,
          dryRunReport: { candidateCount: 1, totalDebit: 120.00 },
          proposed: [baseCandidate]
        });

        if (res2.insertedHeaders !== 0 || res2.alreadyPostedCount !== 1) {
          throw new Error('Exact match duplicate failed to increment alreadyPostedCount');
        }

        // Helper for testing conflict rejections
        async function assertConflict(variantCandidate, errorDescription) {
          const nonceVariant = 'TEST_IDEM_NONCE_V_' + Math.random().toString(36).substring(2);
          const approvalVariant = {
            nonce: nonceVariant,
            manifestDigest: 'digest_variant',
            target: 'local',
            projectRef: '',
            operation: 'FINANCIAL_LEDGER_BACKFILL_EXECUTE',
            approvedBy: 'owner',
            candidateCount: 1,
            totalAmount: variantCandidate.total_debit,
            issuedAtMs: Date.now() - 1000,
            expiresAtMs: Date.now() + 60000
          };

          let errCaught = null;
          try {
            await executeAuthorizedBackfill({
              client: proxyClient,
              target: 'local',
              approvalArtifact: approvalVariant,
              dryRunReport: { candidateCount: 1, totalDebit: variantCandidate.total_debit },
              proposed: [variantCandidate]
            });
          } catch (err) {
            errCaught = err;
          }

          if (!errCaught || errCaught.code !== 'IDEMPOTENCY_CONFLICT_ANOMALY') {
            throw new Error(`Expected IDEMPOTENCY_CONFLICT_ANOMALY for ${errorDescription}, got: ${errCaught ? errCaught.code : 'none'}`);
          }
        }

        // 3. SEC-REC-02: Wrong account code in candidate line
        await assertConflict({
          ...baseCandidate,
          lines: [
            { account_code: 'UNAPPROVED_OTHER_ACCOUNT', entry_type: 'DEBIT', amount: 120.00, entity_type: 'GATEWAY', notes: 'line 1' },
            { account_code: 'CUSTOMER_WALLET_LIABILITY', entry_type: 'CREDIT', amount: 120.00, entity_type: 'CUSTOMER', notes: 'line 2' }
          ]
        }, 'wrong account code in candidate line');

        // 4. SEC-REC-02: Reversed line directions (debit on credit account, credit on debit account)
        await assertConflict({
          ...baseCandidate,
          lines: [
            { account_code: 'CUSTOMER_WALLET_LIABILITY', entry_type: 'DEBIT', amount: 120.00, entity_type: 'CUSTOMER', notes: 'line 1' },
            { account_code: 'PAYMENT_GATEWAY_ESCROW', entry_type: 'CREDIT', amount: 120.00, entity_type: 'GATEWAY', notes: 'line 2' }
          ]
        }, 'reversed line directions');

        // 5. SEC-REC-02: Altered line amounts (debit/credit diverge from 120.00)
        await assertConflict({
          ...baseCandidate,
          lines: [
            { account_code: 'PAYMENT_GATEWAY_ESCROW', entry_type: 'DEBIT', amount: 110.00, entity_type: 'GATEWAY', notes: 'line 1' },
            { account_code: 'CUSTOMER_WALLET_LIABILITY', entry_type: 'CREDIT', amount: 130.00, entity_type: 'CUSTOMER', notes: 'line 2' }
          ]
        }, 'altered line amounts');

        // 6. SEC-REC-02: Diverging header total debit/credit
        await assertConflict({
          ...baseCandidate,
          total_debit: 150.00,
          total_credit: 150.00,
          amount: 150.00
        }, 'diverging header amounts');

        // 7. Verify safeMoneyEquals unit behavior across precision, ranges, and edge cases
        if (!safeMoneyEquals('120.00', 120)) throw new Error('safeMoneyEquals failed on numeric 120');
        if (!safeMoneyEquals('120.50', '120.5')) throw new Error('safeMoneyEquals failed on 120.5 vs 120.50');
        if (!safeMoneyEquals('999999999999.99', 999999999999.99)) throw new Error('safeMoneyEquals failed on max boundary');
        if (safeMoneyEquals('1000000000000.00', 1000000000000)) throw new Error('safeMoneyEquals allowed amount exceeding NUMERIC(14,2)');
        if (safeMoneyEquals('120.50foo', '120.50')) throw new Error('safeMoneyEquals allowed malformed string');
        if (safeMoneyEquals('1e5', '100000.00')) throw new Error('safeMoneyEquals allowed scientific notation');
        if (safeMoneyEquals('-50.00', '-50.00')) throw new Error('safeMoneyEquals allowed negative values');
        if (safeMoneyEquals('120.555', '120.56')) throw new Error('safeMoneyEquals allowed extra precision scale > 2');
        if (safeMoneyEquals('0.00', '0.00')) throw new Error('safeMoneyEquals allowed zero when strictly positive required');
        if (!safeMoneyEquals('0.00', '0.00', { allowZero: true })) throw new Error('safeMoneyEquals failed zero with allowZero: true');
        if (!safeMoneyEquals('0.01', 0.01)) throw new Error('safeMoneyEquals failed on smallest positive boundary 0.01');
        if (safeMoneyEquals(null, 0)) throw new Error('safeMoneyEquals allowed null vs 0');
        if (safeMoneyEquals('', '0.00')) throw new Error('safeMoneyEquals allowed empty string vs 0.00');
        if (safeMoneyEquals(NaN, NaN)) throw new Error('safeMoneyEquals allowed NaN vs NaN');
        if (safeMoneyEquals(Infinity, Infinity)) throw new Error('safeMoneyEquals allowed Infinity');
        if (safeMoneyEquals(undefined, undefined)) throw new Error('safeMoneyEquals allowed undefined vs undefined');

        return {
          exactDuplicateAccepted: true,
          wrongAccountRefused: true,
          reversedDirectionsRefused: true,
          alteredAmountRefused: true,
          headerDivergenceRefused: true,
          safeMoneyEqualsVerified: true
        };
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // -------------------------------------------------------------------------
    // INT-16: Ambiguity Resolution Probe (SEC-REC-01 Verification)
    // -------------------------------------------------------------------------
    test('INT-16', 'Ambiguity resolution probe requires target identity and journal absence before confirming rollback', async () => {
      await client.query('BEGIN');
      try {
        const committedNonce = 'TEST_AMBIG_COMMITTED_' + Date.now();
        const digest = 'test_ambig_digest_123';
        const existingKey = 'recon_existing_probe_' + Date.now();
        const existingTxnId = 'txn_existing_probe_' + Date.now();

        // Setup a synthetic probe transaction within the transaction block (rolled back at end of test)
        await client.query(`
          INSERT INTO journal_transactions (
            transaction_id, idempotency_key, category, total_debit, total_credit,
            description, reference_id, status, created_at
          ) VALUES ($1, $2, 'PAYMENT_CAPTURE', 50.00, 50.00, 'Probe journal', 'ref_probe', 'POSTED', NOW());
        `, [existingTxnId, existingKey]);

        await client.query(`
          INSERT INTO reconciliation_audit_nonces (
            nonce, manifest_digest, target, project_ref, operation, approved_by,
            candidate_count, total_amount, issued_at, expires_at, consumed_by_pid, status
          ) VALUES ($1, $2, 'local', 'local', 'FINANCIAL_LEDGER_BACKFILL_EXECUTE', 'owner_test', 1, 50.00, NOW(), NOW() + interval '10 min', $3, 'COMMITTED');
        `, [committedNonce, digest, process.pid]);

        // 1. Committed confirmed: nonce COMMITTED + digest matches + candidate journals present
        const probe1 = await verifyAmbiguousCommitOutcome({
          client,
          nonce: committedNonce,
          target: 'local',
          expectedManifestDigest: digest,
          candidateIdempotencyKeys: [existingKey]
        });

        // 2. Digest mismatch: must return AMBIGUOUS_REQUIRES_MANUAL_REVIEW
        const probe2 = await verifyAmbiguousCommitOutcome({
          client,
          nonce: committedNonce,
          target: 'local',
          expectedManifestDigest: 'differing_digest',
          candidateIdempotencyKeys: [existingKey]
        });

        // 3. SEC-REC-01: Nonce absent AND zero candidate journals exist: ROLLED_BACK_CONFIRMED
        const probe3 = await verifyAmbiguousCommitOutcome({
          client,
          nonce: 'ABSENT_NONCE_VERIFIED_CLEAN',
          target: 'local',
          candidateIdempotencyKeys: ['absent_key_clean_1', 'absent_key_clean_2']
        });

        // 4. SEC-REC-01: Nonce absent BUT orphan candidate journal exists: AMBIGUOUS_REQUIRES_MANUAL_REVIEW
        const probe4 = await verifyAmbiguousCommitOutcome({
          client,
          nonce: 'ABSENT_NONCE_WITH_ORPHAN',
          target: 'local',
          candidateIdempotencyKeys: [existingKey] // exists in journal_transactions!
        });

        // 5. SEC-REC-01: Nonce absent with empty candidateIdempotencyKeys: AMBIGUOUS_REQUIRES_MANUAL_REVIEW
        const probe5 = await verifyAmbiguousCommitOutcome({
          client,
          nonce: 'ABSENT_NONCE_NO_KEYS_SUPPLIED',
          target: 'local',
          candidateIdempotencyKeys: []
        });

        // 6. SEC-REC-01: Target mismatch (target=staging with loopback DSN): AMBIGUOUS_REQUIRES_MANUAL_REVIEW
        const probe6 = await verifyAmbiguousCommitOutcome({
          client,
          nonce: 'ABSENT_NONCE_TARGET_MISMATCH',
          target: 'staging',
          candidateIdempotencyKeys: ['absent_key_1']
        });

        // 7. SEC-REC-01: Target omitted fails closed as AMBIGUOUS_REQUIRES_MANUAL_REVIEW
        const probe7 = await verifyAmbiguousCommitOutcome({
          client,
          nonce: 'ABSENT_NONCE_NO_TARGET',
          candidateIdempotencyKeys: ['absent_key_1']
        });

        if (probe1.status !== 'COMMITTED_CONFIRMED' || !probe1.resolved) {
          throw new Error(`Probe 1 failed: ${JSON.stringify(probe1)}`);
        }
        if (probe2.status !== 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW' || probe2.resolved !== false) {
          throw new Error(`Probe 2 failed: ${JSON.stringify(probe2)}`);
        }
        if (probe3.status !== 'ROLLED_BACK_CONFIRMED' || !probe3.resolved) {
          throw new Error(`Probe 3 failed: ${JSON.stringify(probe3)}`);
        }
        if (probe4.status !== 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW' || probe4.resolved !== false) {
          throw new Error(`Probe 4 failed: ${JSON.stringify(probe4)}`);
        }
        if (probe5.status !== 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW' || probe5.resolved !== false) {
          throw new Error(`Probe 5 failed: ${JSON.stringify(probe5)}`);
        }
        if (probe6.status !== 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW' || probe6.resolved !== false) {
          throw new Error(`Probe 6 failed: ${JSON.stringify(probe6)}`);
        }
        if (probe7.status !== 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW' || probe7.resolved !== false) {
          throw new Error(`Probe 7 failed: ${JSON.stringify(probe7)}`);
        }

        return {
          committedConfirmed: probe1.status,
          digestMismatchRefused: probe2.status,
          cleanRollbackConfirmed: probe3.status,
          orphanJournalFlagged: probe4.status,
          emptyKeysFlagged: probe5.status,
          targetMismatchFlagged: probe6.status,
          missingTargetFlagged: probe7.status
        };
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // Run all tests sequentially
    for (const t of tests) {
      try {
        const result = await t.fn();
        passed++;
        console.log(`✅ [${t.id}] PASS  ${t.description}`);
      } catch (err) {
        failed++;
        console.error(`❌ [${t.id}] FAIL  ${t.description}`);
        console.error(`   Error: ${err.message}`);
      }
    }

    console.log('\n========================================================================');
    console.log(`📊 RECONCILER INTEGRATION HARNESS: ${passed} PASSED, ${failed} FAILED (Total: ${tests.length})`);
    console.log('========================================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

runHarness().catch(err => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});
