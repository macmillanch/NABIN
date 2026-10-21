/**
 * NABIN — Authoritative Double-Entry Ledger Reconciliation & Backfill Tool
 *
 * Scans Book 1 (ledger_entries) and reconciles unmatched historical entries
 * into Book 2 (journal_transactions & journal_lines).
 *
 * Rules:
 * 1. Dry-run by default. Explicit --execute required to commit.
 * 2. Fail-closed: wraps execution in an atomic database transaction.
 * 3. Multi-layer target identity validation rejecting production targets.
 * 4. Pinned TLS enforcement with fail-closed CA certificate verification.
 * 5. Deterministic dry-run manifest report generation binding 9 accounting fields.
 * 6. Two-stage owner authorization gate requiring an out-of-band Ed25519 signature.
 * 7. Transaction-scoped advisory locking (pg_try_advisory_xact_lock).
 * 8. Durable database-backed nonce replay protection (reconciliation_audit_nonces).
 * 9. Explicit conflict classification replacing silent ON CONFLICT DO NOTHING.
 * 10. Zero candidate drift tolerance between reviewed dry-run and live commit.
 *
 * Usage:
 *   node backend/scripts/with_local_target.js node backend/scripts/reconcile_double_entry_ledger.js [--target=local|staging] [--dry-run|--execute] [--approval-file=path] [--report-out=path]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const crypto = require('crypto');
const reconcilerSecurity = require('../src/services/reconcilerSecurity');
const { ReconcilerSecurityError } = reconcilerSecurity;

const BATCH_ID = 'RECON_20261012';

/**
 * Strict canonical money parser converting to exact integer minor units (paise).
 * - Enforces scale <= 2 (at most 2 decimal digits)
 * - Prohibits scientific notation (e.g., 1e5)
 * - Prohibits partial or trailing non-numeric characters (e.g., 100abc)
 * - Prohibits negative amounts (where prohibited)
 * - Validates range within PostgreSQL NUMERIC(14, 2) maximum (999,999,999,999.99)
 * - Eliminates IEEE 754 binary floating-point representation drift
 *
 * @param {string|number} val - Input monetary value
 * @param {Object} [options]
 * @param {boolean} [options.allowZero=false] - Whether zero is permitted
 * @returns {bigint|null} Exact paise as BigInt, or null if invalid
 */
const CANONICAL_MONEY_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MAX_MONEY_AMOUNT_PAISE = 99999999999999n; // 999,999,999,999.99 in paise (NUMERIC(14, 2))

function parseExactMoneyToPaise(val, { allowZero = false } = {}) {
  if (val === null || val === undefined) return null;
  let str = '';
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) return null;
    str = val.toString();
  } else if (typeof val === 'string') {
    str = val.trim();
  } else {
    return null;
  }

  if (!CANONICAL_MONEY_REGEX.test(str)) {
    return null;
  }

  const parts = str.split('.');
  const intPart = BigInt(parts[0]);
  let decPart = 0n;
  if (parts.length > 1) {
    const decStr = parts[1].padEnd(2, '0');
    decPart = BigInt(decStr);
  }
  const paise = intPart * 100n + decPart;

  if (paise > MAX_MONEY_AMOUNT_PAISE) {
    return null; // Exceeds PostgreSQL NUMERIC(14, 2)
  }

  if (!allowZero && paise === 0n) {
    return null; // Ledger entries must be strictly positive
  }

  return paise;
}

function formatPaiseToDecimalString(paise) {
  const isNeg = paise < 0n;
  const abs = isNeg ? -paise : paise;
  const intStr = (abs / 100n).toString();
  const decStr = (abs % 100n).toString().padStart(2, '0');
  return `${isNeg ? '-' : ''}${intStr}.${decStr}`;
}

/**
 * Exact and safe monetary equality comparison for PostgreSQL NUMERIC values.
 * Fails closed on malformed values, partial numeric strings, missing values,
 * non-finite values, unsupported precision, scientific notation, and values
 * outside permitted database ranges.
 */
function safeMoneyEquals(a, b, options = {}) {
  const paiseA = parseExactMoneyToPaise(a, options);
  const paiseB = parseExactMoneyToPaise(b, options);
  if (paiseA === null || paiseB === null) {
    return false;
  }
  return paiseA === paiseB;
}

/**
 * Executes an engine-level read-only scan of Book 1 and Book 2.
 * Returns classified entries and computes candidate manifest.
 *
 * @param {Object} options
 * @param {Client} options.client - Connected PostgreSQL client
 * @param {string} options.target - 'local' or 'staging'
 * @returns {Promise<Object>} Dry-run report object with computed manifestDigest
 */
async function runDryRunScan({ client, target }) {
  // 1. Enter engine-level READ ONLY transaction
  await client.query(reconcilerSecurity.getDryRunTransactionSql());

  try {
    // 2. Pre-audit: Load authoritative chart of accounts
    const accRes = await client.query('SELECT account_code FROM ledger_accounts WHERE is_active = true');
    const validAccounts = new Set(accRes.rows.map(r => r.account_code));

    // 3. Fetch all Book 1 entries
    const leRes = await client.query(`
      SELECT 
        le.id,
        le.entry_id,
        le.job_id,
        le.category,
        le.debit_account,
        le.credit_account,
        le.amount,
        le.currency,
        le.description,
        le.reference_id,
        le.created_at
      FROM ledger_entries le
      ORDER BY le.created_at ASC, le.entry_id ASC
    `);

    // 4. Inspect existing Book 2 journals for matching
    const jtRes = await client.query(`
      SELECT transaction_id, idempotency_key, reference_id, category, total_debit, total_credit
      FROM journal_transactions
    `);
    const existingRefs = new Set();
    const existingIdem = new Set();
    const existingTxn = new Set();
    for (const jt of jtRes.rows) {
      if (jt.reference_id) existingRefs.add(jt.reference_id);
      if (jt.idempotency_key) existingIdem.add(jt.idempotency_key);
      if (jt.transaction_id) existingTxn.add(jt.transaction_id);
    }

    // 5. Classify each entry
    const matched = [];
    const proposed = [];
    const quarantined = [];

    for (const entry of leRes.rows) {
      const { entry_id, reference_id, category, amount, currency, debit_account, credit_account } = entry;
      const numAmount = parseFloat(amount);

      const isMatched = existingRefs.has(reference_id) || 
                        existingIdem.has(`recon_${entry_id}`) ||
                        existingIdem.has(`ref_${reference_id}`) ||
                        existingIdem.has(`cap_${reference_id}`) ||
                        existingTxn.has(`txn_recon_${entry_id}`);

      if (isMatched) {
        matched.push(entry);
        continue;
      }

      // Referential & anomaly validations
      const errors = [];
      if (!entry_id || !entry_id.trim()) errors.push('MISSING_ENTRY_ID');
      const entryPaise = parseExactMoneyToPaise(amount);
      if (entryPaise === null) errors.push(`INVALID_AMOUNT:${amount}`);
      if (currency !== 'INR') errors.push(`UNSUPPORTED_CURRENCY:${currency}`);
      if (!validAccounts.has(debit_account)) errors.push(`UNKNOWN_DEBIT_ACCOUNT:${debit_account}`);
      if (!validAccounts.has(credit_account)) errors.push(`UNKNOWN_CREDIT_ACCOUNT:${credit_account}`);

      // Map Category to journal_transactions Category
      let jtCategory;
      if (category === 'DISPUTE_REFUND') {
        jtCategory = 'DISPUTE_REFUND';
      } else if (category && category.includes('PAYMENT_CAPTURE')) {
        jtCategory = 'PAYMENT_CAPTURE';
      } else if (category && category.includes('SETTLEMENT')) {
        jtCategory = category;
      } else {
        errors.push(`UNKNOWN_CATEGORY:${category}`);
      }

      if (errors.length > 0) {
        quarantined.push({ entry, errors });
        continue;
      }

      // Generate proposed journal entry
      const idemKey = `recon_${entry_id}`;
      const txnHash = crypto.createHash('md5').update(idemKey).digest('hex').substring(0, 20);
      const txnId = `txn_recon_${txnHash}`;

      proposed.push({
        source_id: entry.id,
        source_entry_id: entry_id,
        entry_id: entry_id,
        job_id: entry.job_id || '',
        transaction_id: txnId,
        idempotency_key: idemKey,
        category: jtCategory,
        total_debit: numAmount,
        total_credit: numAmount,
        amount: numAmount,
        debit_account: debit_account,
        credit_account: credit_account,
        currency: currency || 'INR',
        reference_id: reference_id || '',
        description: `Historical reconciliation [${category}]: ${entry_id}`,
        created_at: entry.created_at,
        lines: [
          {
            account_code: debit_account,
            entry_type: 'DEBIT',
            amount: numAmount,
            entity_type: category === 'DISPUTE_REFUND' ? 'CUSTOMER' : 'GATEWAY',
            notes: `[Reconciled] Debit ${debit_account}`
          },
          {
            account_code: credit_account,
            entry_type: 'CREDIT',
            amount: numAmount,
            entity_type: category === 'DISPUTE_REFUND' ? 'GATEWAY' : (credit_account === 'MERCHANT_PAYABLE' ? 'MERCHANT' : 'CUSTOMER'),
            notes: `[Reconciled] Credit ${credit_account}`
          }
        ]
      });
    }

    // 6. Aggregate Findings (exact minor unit BigInt accumulation, zero floating-point arithmetic)
    const proposedByCategory = {};
    let totalProposedPaise = 0n;
    for (const p of proposed) {
      if (!proposedByCategory[p.category]) {
        proposedByCategory[p.category] = { count: 0, amountPaise: 0n };
      }
      proposedByCategory[p.category].count++;
      const pPaise = parseExactMoneyToPaise(p.total_debit);
      if (pPaise === null) {
        throw new ReconcilerSecurityError(
          `Candidate entry ${p.entry_id} has invalid money precision or range: ${p.total_debit}`,
          'INVALID_MONEY_PRECISION'
        );
      }
      proposedByCategory[p.category].amountPaise += pPaise;
      totalProposedPaise += pPaise;
    }

    for (const cat of Object.keys(proposedByCategory)) {
      proposedByCategory[cat].amount = Number(formatPaiseToDecimalString(proposedByCategory[cat].amountPaise));
    }
    const totalDecimalStr = formatPaiseToDecimalString(totalProposedPaise);
    const totalProposedAmount = Number(totalDecimalStr);

    const report = {
      target,
      projectRef: target === 'staging' ? reconcilerSecurity.SANCTIONED_STAGING_REF : '',
      batchId: BATCH_ID,
      scannedAt: new Date().toISOString(),
      baselineVersion: '039',
      candidateCount: proposed.length,
      totalDebit: Number(totalProposedAmount.toFixed(2)),
      totalCredit: Number(totalProposedAmount.toFixed(2)),
      matchedCount: matched.length,
      quarantinedCount: quarantined.length,
      proposedByCategory,
      quarantinedEntries: quarantined,
      candidateEntries: proposed
    };

    report.manifestDigest = reconcilerSecurity.computeReportManifest(report);
    return report;
  } finally {
    // 7. Explicitly roll back the read-only transaction
    await client.query(reconcilerSecurity.getDryRunRollbackSql()).catch(() => {});
  }
}

/**
 * Executes an atomic backfill write transaction with advisory lock, durable nonce,
 * explicit conflict classification, row-count assertions, and post-write verification.
 *
 * @param {Object} options
 * @param {Client} options.client
 * @param {string} options.target
 * @param {Object} options.approvalArtifact
 * @param {Object} options.dryRunReport
 * @param {Array} options.proposed
 * @returns {Promise<Object>} Execution result summary
 */
async function executeAuthorizedBackfill({ client, target, approvalArtifact, dryRunReport, proposed }) {
  await client.query('BEGIN');
  try {
    // 1. Transaction-scoped non-blocking advisory lock with 5s timeout
    await client.query("SET LOCAL lock_timeout = '5s';");
    const lockRes = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('nabin_reconciliation_backfill_lock')) AS acquired;");
    if (!lockRes || !lockRes.rows || !lockRes.rows[0] || !lockRes.rows[0].acquired) {
      throw new ReconcilerSecurityError(
        'Concurrent reconciliation transaction in progress. Advisory lock nabin_reconciliation_backfill_lock is already held.',
        'CONCURRENT_RECONCILIATION_IN_PROGRESS'
      );
    }

    // 2. Insert durable nonce reservation (fails closed on duplicate nonce via PK constraint 23505)
    await client.query(`
      INSERT INTO reconciliation_audit_nonces (
        nonce, manifest_digest, target, project_ref, operation, approved_by,
        candidate_count, total_amount, issued_at, expires_at, consumed_by_pid, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0), to_timestamp($10 / 1000.0), $11, 'COMMITTED');
    `, [
      approvalArtifact.nonce,
      approvalArtifact.manifestDigest,
      approvalArtifact.target,
      approvalArtifact.projectRef || (target === 'staging' ? reconcilerSecurity.SANCTIONED_STAGING_REF : 'local'),
      approvalArtifact.operation,
      approvalArtifact.approvedBy,
      approvalArtifact.candidateCount,
      approvalArtifact.totalAmount,
      approvalArtifact.issuedAtMs,
      approvalArtifact.expiresAtMs,
      process.pid
    ]);

    let insertedHeaders = 0;
    let insertedLines = 0;
    let alreadyPostedCount = 0;

    // 3. Write each candidate with explicit conflict classification
    for (const p of proposed) {
      const jtInsert = await client.query(`
        INSERT INTO journal_transactions (
          transaction_id, idempotency_key, category, job_id, total_debit, total_credit,
          description, reference_id, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'POSTED', $9)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id;
      `, [p.transaction_id, p.idempotency_key, p.category, p.job_id || null, p.total_debit, p.total_credit, p.description, p.reference_id, p.created_at]);

      if (jtInsert.rows.length > 0) {
        const journalId = jtInsert.rows[0].id;
        insertedHeaders++;

        for (const l of p.lines) {
          await client.query(`
            INSERT INTO journal_lines (
              journal_id, account_code, entry_type, amount, entity_type, entity_id, notes, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
          `, [journalId, l.account_code, l.entry_type, l.amount, l.entity_type, 'RECONCILED', l.notes, p.created_at]);
          insertedLines++;
        }
      } else {
        // Conflict detected: query existing record to classify exact duplicate vs unexpected collision
        const confRes = await client.query(`
          SELECT id, transaction_id, category, job_id, total_debit, total_credit, reference_id, status
          FROM journal_transactions
          WHERE idempotency_key = $1;
        `, [p.idempotency_key]);

        if (confRes.rows.length !== 1) {
          throw new ReconcilerSecurityError(
            `Idempotency conflict on ${p.idempotency_key}: expected exactly 1 existing header, found ${confRes.rows.length}.`,
            'IDEMPOTENCY_CONFLICT_ANOMALY'
          );
        }

        const existing = confRes.rows[0];
        const isHeaderMatch = 
          safeMoneyEquals(existing.total_debit, p.total_debit) &&
          safeMoneyEquals(existing.total_credit, p.total_credit) &&
          existing.category === p.category &&
          String(existing.reference_id || '') === String(p.reference_id || '') &&
          String(existing.job_id || '') === String(p.job_id || '') &&
          existing.status === 'POSTED';

        if (!isHeaderMatch) {
          throw new ReconcilerSecurityError(
            `Unexpected idempotency conflict on ${p.idempotency_key}: existing transaction ${existing.transaction_id} diverges from candidate (amount: ${existing.total_debit} vs ${p.total_debit}, ref: ${existing.reference_id} vs ${p.reference_id}, cat: ${existing.category} vs ${p.category}).`,
            'IDEMPOTENCY_CONFLICT_ANOMALY'
          );
        }

        // Verify that exactly 2 balanced lines exist for this journal
        const linesRes = await client.query(`
          SELECT id, account_code, entry_type, amount FROM journal_lines WHERE journal_id = $1;
        `, [existing.id]);

        if (linesRes.rows.length !== 2) {
          throw new ReconcilerSecurityError(
            `Existing journal transaction ${existing.transaction_id} has ${linesRes.rows.length} lines, expected exactly 2 balanced lines.`,
            'IDEMPOTENCY_CONFLICT_ANOMALY'
          );
        }

        // Verify candidate lines specification
        if (!Array.isArray(p.lines) || p.lines.length !== 2) {
          throw new ReconcilerSecurityError(
            `Candidate entry ${p.entry_id} must have exactly 2 lines.`,
            'IDEMPOTENCY_CONFLICT_ANOMALY'
          );
        }

        const expectedDebit = p.lines.find(l => l.entry_type === 'DEBIT');
        const expectedCredit = p.lines.find(l => l.entry_type === 'CREDIT');

        if (!expectedDebit || !expectedCredit) {
          throw new ReconcilerSecurityError(
            `Candidate entry ${p.entry_id} must have one DEBIT and one CREDIT line.`,
            'IDEMPOTENCY_CONFLICT_ANOMALY'
          );
        }

        const actualDebits = linesRes.rows.filter(l => l.entry_type === 'DEBIT');
        const actualCredits = linesRes.rows.filter(l => l.entry_type === 'CREDIT');

        if (actualDebits.length !== 1 || actualCredits.length !== 1) {
          throw new ReconcilerSecurityError(
            `Existing journal lines for ${existing.transaction_id} lack symmetrical DEBIT/CREDIT legs (debits: ${actualDebits.length}, credits: ${actualCredits.length}).`,
            'IDEMPOTENCY_CONFLICT_ANOMALY'
          );
        }

        const actualDebit = actualDebits[0];
        const actualCredit = actualCredits[0];

        // Safe decimal amount and account code comparisons
        const debitAmountMatch = safeMoneyEquals(actualDebit.amount, expectedDebit.amount);
        const creditAmountMatch = safeMoneyEquals(actualCredit.amount, expectedCredit.amount);
        const debitAccountMatch = actualDebit.account_code === expectedDebit.account_code;
        const creditAccountMatch = actualCredit.account_code === expectedCredit.account_code;

        if (!debitAmountMatch || !creditAmountMatch || !debitAccountMatch || !creditAccountMatch) {
          throw new ReconcilerSecurityError(
            `Existing journal lines diverge from candidate legs on transaction ${existing.transaction_id} (debitAccount: ${actualDebit.account_code} vs ${expectedDebit.account_code}, creditAccount: ${actualCredit.account_code} vs ${expectedCredit.account_code}, debitAmount: ${actualDebit.amount} vs ${expectedDebit.amount}, creditAmount: ${actualCredit.amount} vs ${expectedCredit.amount}).`,
            'IDEMPOTENCY_CONFLICT_ANOMALY'
          );
        }

        alreadyPostedCount++;
      }
    }

    // 4. Row-count assertions
    if (insertedHeaders + alreadyPostedCount !== proposed.length) {
      throw new ReconcilerSecurityError(
        `Header count assertion failed: inserted (${insertedHeaders}) + alreadyPosted (${alreadyPostedCount}) !== candidateCount (${proposed.length}).`,
        'HEADER_COUNT_MISMATCH'
      );
    }

    if (insertedLines !== insertedHeaders * 2) {
      throw new ReconcilerSecurityError(
        `Line count assertion failed: insertedLines (${insertedLines}) !== insertedHeaders * 2 (${insertedHeaders * 2}).`,
        'LINE_COUNT_MISMATCH'
      );
    }

    // 5. Post-backfill ledger integrity balance query
    const postCheck = await client.query(`
      SELECT 
        (SELECT count(*)::int FROM journal_transactions WHERE idempotency_key LIKE 'recon_%' AND total_debit <> total_credit) AS unbalanced_count,
        (SELECT count(*)::int FROM journal_lines jl JOIN journal_transactions jt ON jl.journal_id = jt.id WHERE jt.idempotency_key LIKE 'recon_%' AND NOT EXISTS (SELECT 1 FROM ledger_accounts la WHERE la.account_code = jl.account_code)) AS invalid_account_count;
    `);

    if (postCheck.rows[0].unbalanced_count > 0 || postCheck.rows[0].invalid_account_count > 0) {
      throw new ReconcilerSecurityError(
        `Post-backfill ledger integrity violated: unbalanced=${postCheck.rows[0].unbalanced_count}, invalid_accounts=${postCheck.rows[0].invalid_account_count}.`,
        'LEDGER_INTEGRITY_VIOLATION'
      );
    }

    await client.query('COMMIT');

    return {
      success: true,
      insertedHeaders,
      insertedLines,
      alreadyPostedCount,
      totalProcessed: proposed.length,
      nonce: approvalArtifact.nonce
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Resolves whether a transaction whose commit outcome was ambiguous (e.g. dropped socket during commit)
 * actually landed in the database.
 * If the outcome cannot be established conclusively, returns resolved: false requiring manual review.
 *
 * Rules:
 * - Nonce absence alone must NEVER prove rollback.
 * - Intended target identity must be independently validated.
 * - Zero matching journal headers or lines must exist for candidate keys to confirm rollback.
 * - Any query failure, connection error, or partial state returns AMBIGUOUS_REQUIRES_MANUAL_REVIEW.
 *
 * @param {Object} options
 * @param {Client} options.client
 * @param {string} options.nonce
 * @param {string} [options.target] - 'local' or 'staging'
 * @param {string} [options.expectedManifestDigest]
 * @param {string[]} [options.candidateIdempotencyKeys]
 * @param {string} [options.dbUrl]
 * @param {Object} [options.env]
 * @returns {Promise<Object>} Outcome resolution report
 */
async function verifyAmbiguousCommitOutcome({
  client,
  nonce,
  target,
  expectedManifestDigest,
  candidateIdempotencyKeys = [],
  dbUrl = process.env.DATABASE_URL,
  env = process.env
}) {
  if (!client || !nonce || !target) {
    return {
      resolved: false,
      status: 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW',
      message: 'Client, nonce, and target are required for ambiguous commit outcome verification.'
    };
  }

  try {
    // 1. Revalidate database connection & target identity using existing security policy
    reconcilerSecurity.validateTargetConfiguration({ target, dbUrl, env });
    await reconcilerSecurity.verifyInBandDatabaseIdentity({ client, target });

    // 2. Query nonce reservation
    const nonceRes = await client.query(`
      SELECT nonce, manifest_digest, target, project_ref, operation, approved_by,
             candidate_count, total_amount, issued_at, expires_at, consumed_at, consumed_by_pid, status
      FROM reconciliation_audit_nonces
      WHERE nonce = $1;
    `, [nonce]);

    // 3. Query candidate journals & lines existence
    let candidateJournalsCount = 0;
    let candidateLinesCount = 0;
    if (Array.isArray(candidateIdempotencyKeys) && candidateIdempotencyKeys.length > 0) {
      const cjRes = await client.query(`
        SELECT count(*)::int AS count
        FROM journal_transactions
        WHERE idempotency_key = ANY($1::text[]);
      `, [candidateIdempotencyKeys]);
      candidateJournalsCount = cjRes.rows[0].count;

      const clRes = await client.query(`
        SELECT count(*)::int AS count
        FROM journal_lines jl
        JOIN journal_transactions jt ON jl.journal_id = jt.id
        WHERE jt.idempotency_key = ANY($1::text[]);
      `, [candidateIdempotencyKeys]);
      candidateLinesCount = clRes.rows[0].count;
    }

    // 4. Case: Nonce committed
    if (nonceRes.rows.length === 1) {
      const row = nonceRes.rows[0];
      const digestMatches = !expectedManifestDigest || row.manifest_digest === expectedManifestDigest;

      if (row.status === 'COMMITTED' && digestMatches) {
        if (candidateIdempotencyKeys.length > 0 && candidateJournalsCount !== candidateIdempotencyKeys.length) {
          return {
            resolved: false,
            status: 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW',
            message: `Nonce committed but candidate journals count (${candidateJournalsCount}) diverges from expected (${candidateIdempotencyKeys.length}). STOP for manual review.`,
            nonceRow: row,
            candidateJournalsCount,
            candidateLinesCount
          };
        }

        return {
          resolved: true,
          status: 'COMMITTED_CONFIRMED',
          message: `Transaction conclusively established as COMMITTED at ${row.consumed_at}.`,
          nonceRow: row,
          candidateJournalsCount,
          candidateLinesCount
        };
      }

      return {
        resolved: false,
        status: 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW',
        message: `Nonce found in unexpected state (status: ${row.status}, digestMatch: ${digestMatches}). STOP for manual review.`,
        nonceRow: row,
        candidateJournalsCount,
        candidateLinesCount
      };
    }

    // 5. Case: Nonce absent
    if (nonceRes.rows.length === 0) {
      // Nonce absence alone must never prove rollback
      if (!Array.isArray(candidateIdempotencyKeys) || candidateIdempotencyKeys.length === 0) {
        return {
          resolved: false,
          status: 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW',
          message: 'Nonce is absent, but candidate idempotency keys were not provided to verify journal absence. Nonce absence alone cannot prove rollback. STOP for manual review.',
          nonceRow: null,
          candidateJournalsCount,
          candidateLinesCount
        };
      }

      if (candidateJournalsCount > 0 || candidateLinesCount > 0) {
        return {
          resolved: false,
          status: 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW',
          message: `Nonce is absent, but found ${candidateJournalsCount} journal header(s) and ${candidateLinesCount} journal line(s) for candidate keys. Conflicting partial state detected! STOP for manual review.`,
          nonceRow: null,
          candidateJournalsCount,
          candidateLinesCount
        };
      }

      return {
        resolved: true,
        status: 'ROLLED_BACK_CONFIRMED',
        message: 'Transaction conclusively established as ROLLED_BACK: verified target database, nonce is absent, and zero matching journal headers or lines exist for candidate set. Safe to retry with unexpired approval.',
        nonceRow: null,
        candidateJournalsCount: 0,
        candidateLinesCount: 0
      };
    }

    return {
      resolved: false,
      status: 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW',
      message: `Unexpected nonce query result (${nonceRes.rows.length} rows). STOP for manual review.`,
      nonceRow: null
    };

  } catch (err) {
    return {
      resolved: false,
      status: 'AMBIGUOUS_REQUIRES_MANUAL_REVIEW',
      message: `Ambiguity resolution probe encountered error: ${err.message}. Connection failure or probe error cannot prove rollback. STOP for manual review.`,
      error: err.code || err.message
    };
  }
}

/**
 * Main command line execution router.
 */
async function main(argv = process.argv) {
  const isExecute = argv.includes('--execute');
  const isDryRun = !isExecute || argv.includes('--dry-run');

  const targetArg = argv.find(a => a.startsWith('--target='));
  const target = targetArg ? targetArg.split('=')[1] : (process.env.NABIN_TARGET || 'local');

  const reportOutArg = argv.find(a => a.startsWith('--report-out='));
  const reportOutPath = reportOutArg ? reportOutArg.split('=')[1] : null;

  const approvalFileArg = argv.find(a => a.startsWith('--approval-file='));
  const approvalFilePath = approvalFileArg ? approvalFileArg.split('=')[1] : null;

  const ownerKeyArg = argv.find(a => a.startsWith('--owner-key='));
  const ownerPublicKey = ownerKeyArg ? ownerKeyArg.split('=')[1] : process.env.NABIN_RECONCILER_OWNER_PUBLIC_KEY;

  console.log('========================================================================');
  console.log(`NABIN DOUBLE-ENTRY LEDGER RECONCILIATION TOOL`);
  console.log(`Mode:       ${isDryRun ? 'DRY-RUN (READ-ONLY SIMULATION)' : 'EXECUTE (LIVE ATOMIC BACKFILL)'}`);
  console.log(`Target:     ${target.toUpperCase()}`);
  console.log(`Batch ID:   ${BATCH_ID}`);
  console.log('========================================================================\n');

  // 1. Target Pre-Flight Validation
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const targetConfig = reconcilerSecurity.validateTargetConfiguration({
    target,
    dbUrl,
    env: process.env
  });

  console.log(`🔒 Target Pre-flight: PASS [${targetConfig.redactedUrl}] (TLS: ${targetConfig.ssl ? 'PINNED' : 'DISABLED_LOCAL'})`);

  const client = new Client({
    connectionString: dbUrl,
    ssl: targetConfig.ssl || false
  });
  await client.connect();

  try {
    // 2. In-Band Database Identity & Migration 039 Baseline Probe
    const identityReport = await reconcilerSecurity.verifyInBandDatabaseIdentity({ client, target });
    console.log(`✅ In-band Identity Verified: db=${identityReport.connectedDatabase}, user=${identityReport.connectedUser}, baseline=${identityReport.migrationName}\n`);

    // 3. Engine-Level Read-Only Dry-Run Scan
    const dryRunReport = await runDryRunScan({ client, target });

    console.log('--- RECONCILIATION CLASSIFICATION SUMMARY ---');
    console.log(`Already Matched in Book 2:     ${dryRunReport.matchedCount} entries`);
    console.log(`Proposed for Backfill:          ${dryRunReport.candidateCount} entries`);
    console.log(`Quarantined / Exceptions:       ${dryRunReport.quarantinedCount} entries\n`);

    console.log('--- PROPOSED BACKFILL BREAKDOWN ---');
    for (const [cat, data] of Object.entries(dryRunReport.proposedByCategory)) {
      console.log(`  ${cat.padEnd(25)}: ${String(data.count).padStart(5)} rows | Total: ₹${data.amount.toFixed(2)}`);
    }
    console.log(`  ${'TOTAL PROPOSED'.padEnd(25)}: ${String(dryRunReport.candidateCount).padStart(5)} rows | Total: ₹${dryRunReport.totalDebit.toFixed(2)}\n`);
    console.log(`Manifest SHA-256 Digest: ${dryRunReport.manifestDigest}\n`);

    if (dryRunReport.quarantinedCount > 0) {
      console.warn('⚠️ QUARANTINED RECORDS DETECTED:');
      for (const q of dryRunReport.quarantinedEntries) {
        console.warn(`  Entry: ${q.entry.entry_id} | Errors: ${q.errors.join(', ')}`);
      }
    } else {
      console.log('✅ ZERO Quarantined records. All candidate entries passed referential and arithmetic integrity checks.');
    }

    // Save report artifact if requested
    if (reportOutPath) {
      const resolvedReportPath = path.resolve(reportOutPath);
      fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true });
      fs.writeFileSync(resolvedReportPath, JSON.stringify(dryRunReport, null, 2), 'utf8');
      console.log(`\n📄 Dry-run report artifact saved to: ${resolvedReportPath}`);
    }

    // 4. Halt if dry-run
    if (isDryRun) {
      console.log('\n[DRY-RUN COMPLETE] Engine-level READ ONLY transaction rolled back. Zero changes written to database.');
      console.log('To execute backfill in local development, review manifest digest and run with:');
      console.log('  --execute --approval-file=<path_to_signed_approval.json>');
      return dryRunReport;
    }

    // 5. Pre-Execution Authorization Gate
    if (!approvalFilePath) {
      throw new ReconcilerSecurityError(
        'Live backfill requested (--execute) but --approval-file=<path> was not provided. Execution refused.',
        'APPROVAL_ARTIFACT_MISSING'
      );
    }

    const resolvedApprovalPath = path.resolve(approvalFilePath);
    if (!fs.existsSync(resolvedApprovalPath)) {
      throw new ReconcilerSecurityError(
        `Approval artifact file not found: ${resolvedApprovalPath}`,
        'APPROVAL_FILE_NOT_FOUND'
      );
    }

    const rawApproval = fs.readFileSync(resolvedApprovalPath, 'utf8');
    let approvalArtifact;
    try {
      approvalArtifact = JSON.parse(rawApproval);
    } catch (err) {
      throw new ReconcilerSecurityError(`Invalid JSON in approval file: ${err.message}`, 'APPROVAL_JSON_INVALID');
    }

    console.log('\n--- VERIFYING OWNER AUTHORIZATION GATE ---');
    const authResult = reconcilerSecurity.validateBackfillExecutionAuthorization({
      dryRunReport,
      approvalArtifact,
      liveCandidateSet: dryRunReport.candidateEntries,
      currentTimestampMs: Date.now(),
      trustedPublicKey: ownerPublicKey,
      expectedOwnerIdentity: process.env.NABIN_RECONCILER_OWNER_IDENTITY
    });

    console.log(`✅ Authorization Verified: Approved by ${authResult.approvedBy}`);
    console.log(`   Nonce:     ${authResult.nonce}`);
    console.log(`   Digest:    ${authResult.manifestDigest}`);
    console.log(`   Candidates: ${authResult.candidateCount}`);

    // 6. Execute Atomic Backfill
    console.log('\n--- EXECUTING ATOMIC HISTORICAL BACKFILL ---');
    const execResult = await executeAuthorizedBackfill({
      client,
      target,
      approvalArtifact,
      dryRunReport,
      proposed: dryRunReport.candidateEntries
    });

    console.log(`✅ ATOMIC BACKFILL COMMITTED SUCCESSFULLY!`);
    console.log(`   Headers Inserted:       ${execResult.insertedHeaders}`);
    console.log(`   Lines Inserted:         ${execResult.insertedLines}`);
    console.log(`   Already Posted Matches: ${execResult.alreadyPostedCount}`);
    console.log(`   Audit Nonce Consumed:   ${execResult.nonce}`);

    // Verify post-backfill state
    const postCheck = await client.query(`
      SELECT 
        (SELECT count(*) FROM journal_transactions WHERE idempotency_key LIKE 'recon_%') as recon_headers,
        (SELECT count(*) FROM journal_lines WHERE notes LIKE '[Reconciled]%') as recon_lines,
        (SELECT count(*) FROM reconciliation_audit_nonces WHERE nonce = $1) as nonce_persisted,
        (SELECT count(*) FROM journal_transactions WHERE total_debit <> total_credit) as unbalanced_txns
    `, [execResult.nonce]);
    console.log('\nPost-Backfill Verification Query:');
    console.table(postCheck.rows);

    return execResult;
  } catch (err) {
    console.error(`\n❌ RECONCILIATION TERMINATED: [${err.code || 'ERROR'}] ${err.message}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}

module.exports = {
  BATCH_ID,
  main,
  runDryRunScan,
  executeAuthorizedBackfill,
  verifyAmbiguousCommitOutcome,
  parseExactMoneyToPaise,
  formatPaiseToDecimalString,
  safeMoneyEquals
};
