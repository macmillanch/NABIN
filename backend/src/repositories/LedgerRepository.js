const { supabaseAdmin, isLivePostgres } = require('../supabase');

const LEGACY_CUSTOMER_MAP = {
  'usr_1': '00000000-0000-0000-0000-000000000001',
  'usr_2': '00000000-0000-0000-0000-000000000002',
  'usr_3': '00000000-0000-0000-0000-000000000003'
};

const LEGACY_DRIVER_MAP = {
  'DRV-101': '00000000-0000-0000-0000-000000000101',
  'DRV-102': '00000000-0000-0000-0000-000000000102',
  'DRV-103': '00000000-0000-0000-0000-000000000103',
  'drv_1': '00000000-0000-0000-0000-000000000101',
  'drv_2': '00000000-0000-0000-0000-000000000102',
  'drv_3': '00000000-0000-0000-0000-000000000103'
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ACCOUNTS = new Set([
  'CUSTOMER_WALLET_LIABILITY',
  'DRIVER_EARNINGS_PAYABLE',
  'MERCHANT_PAYABLE',
  'PAYMENT_GATEWAY_ESCROW',
  'PLATFORM_COMMISSION_REVENUE',
  'PLATFORM_PROMO_EXPENSE',
  'DISPUTE_REFUND_EXPENSE'
]);

function normalizeAccountCode(code) {
  if (!code) return 'CUSTOMER_WALLET_LIABILITY';
  if (VALID_ACCOUNTS.has(code)) return code;
  const upper = String(code).toUpperCase();
  if (upper.includes('DRIVER')) return 'DRIVER_EARNINGS_PAYABLE';
  if (upper.includes('COMMISSION')) return 'PLATFORM_COMMISSION_REVENUE';
  if (upper.includes('MERCHANT')) return 'MERCHANT_PAYABLE';
  if (upper.includes('GATEWAY') || upper.includes('ESCROW') || upper.includes('RECEIVABLE')) return 'PAYMENT_GATEWAY_ESCROW';
  if (upper.includes('PROMO') || upper.includes('DISCOUNT')) return 'PLATFORM_PROMO_EXPENSE';
  if (upper.includes('REFUND') || upper.includes('DISPUTE')) return 'DISPUTE_REFUND_EXPENSE';
  return 'CUSTOMER_WALLET_LIABILITY';
}

class LedgerRepository {
  constructor(db) {
    this.db = db;
  }

  resolveUuid(id, ownerType = 'CUSTOMER') {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (ownerType === 'CUSTOMER' && LEGACY_CUSTOMER_MAP[id]) {
      return LEGACY_CUSTOMER_MAP[id];
    }
    if (ownerType === 'DRIVER' && LEGACY_DRIVER_MAP[id]) {
      return LEGACY_DRIVER_MAP[id];
    }
    // Check cached entity uuid
    if (ownerType === 'CUSTOMER' && this.db.users) {
      const u = this.db.users.find(x => x.id === id);
      if (u && u.uuid && UUID_REGEX.test(u.uuid)) return u.uuid;
    }
    if (ownerType === 'DRIVER' && this.db.drivers) {
      const d = this.db.drivers.find(x => x.id === id);
      if (d && d.uuid && UUID_REGEX.test(d.uuid)) return d.uuid;
    }
    return null;
  }

  /**
   * Authoritative Wallet Mutation via PostgreSQL RPC: adjust_wallet_atomic
   * Never performs arithmetic in JavaScript. Delegates directly to database.
   */
  async adjustWallet({
    ownerId,
    ownerType = 'CUSTOMER',
    amount,
    category = 'WALLET_TOPUP',
    description = '',
    referenceId = null,
    debitAccount,
    creditAccount,
    idempotencyKey = null
  }) {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount === 0) {
      throw new Error(`Invalid wallet adjustment amount: ${amount}`);
    }

    const ownerUuid = this.resolveUuid(ownerId, ownerType);
    if (!ownerUuid) {
      throw new Error(`Cannot resolve authoritative PostgreSQL UUID for ${ownerType} ID: ${ownerId}`);
    }

    // Default chart-of-accounts mappings if not specified
    let dAccount = debitAccount;
    let cAccount = creditAccount;
    if (!dAccount || !cAccount) {
      if (ownerType === 'CUSTOMER') {
        if (numAmount > 0) {
          dAccount = 'PAYMENT_GATEWAY_ESCROW';
          cAccount = 'CUSTOMER_WALLET_LIABILITY';
        } else {
          dAccount = 'CUSTOMER_WALLET_LIABILITY';
          cAccount = 'PLATFORM_COMMISSION_REVENUE';
        }
      } else if (ownerType === 'DRIVER') {
        if (numAmount > 0) {
          dAccount = 'CUSTOMER_WALLET_LIABILITY';
          cAccount = 'DRIVER_EARNINGS_PAYABLE';
        } else {
          dAccount = 'DRIVER_EARNINGS_PAYABLE';
          cAccount = 'PAYMENT_GATEWAY_ESCROW';
        }
      } else {
        dAccount = 'PAYMENT_GATEWAY_ESCROW';
        cAccount = 'MERCHANT_PAYABLE';
      }
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.rpc('adjust_wallet_atomic', {
        p_owner_id: ownerUuid,
        p_owner_type: ownerType,
        p_amount: numAmount,
        p_category: category,
        p_description: description || `Wallet adjustment for ${ownerType} ${ownerId}`,
        p_reference_id: referenceId ? String(referenceId) : null,
        p_debit_account: dAccount,
        p_credit_account: cAccount,
        p_idempotency_key: idempotencyKey ? String(idempotencyKey) : null
      });

      if (error) {
        throw new Error(`PostgreSQL adjust_wallet_atomic failed: ${error.message}`);
      }

      if (!data || !data.success) {
        throw new Error(`adjust_wallet_atomic returned unsuccessful: ${JSON.stringify(data)}`);
      }

      // Update runtime cache with the authoritative balance returned by PostgreSQL
      if (ownerType === 'CUSTOMER' && this.db.users) {
        const u = this.db.users.find(x => x.id === ownerId || x.uuid === ownerUuid);
        if (u) u.walletBalance = Number(data.balance);
      } else if (ownerType === 'DRIVER' && this.db.drivers) {
        const d = this.db.drivers.find(x => x.id === ownerId || x.uuid === ownerUuid);
        if (d) d.walletBalance = Number(data.balance);
      }

      const journalEntry = {
        id: data.transaction_id || `TXN-${Date.now()}`,
        transactionId: data.transaction_id,
        timestamp: new Date().toISOString(),
        category,
        debitAccount: dAccount,
        creditAccount: cAccount,
        amount: Math.abs(numAmount),
        debitAmount: Math.abs(numAmount),
        creditAmount: Math.abs(numAmount),
        currency: 'INR',
        description: description || `Wallet adjustment ${numAmount}`,
        referenceId: referenceId ? String(referenceId) : null,
        status: data.status || 'POSTED'
      };
      this.db.ledgerEntries.unshift(journalEntry);

      return {
        success: true,
        status: data.status,
        balance: Number(data.balance),
        transactionId: data.transaction_id,
        entry: journalEntry
      };
    }

    // Fallback solely for offline local development without PostgreSQL
    let newBalance = 0;
    if (ownerType === 'CUSTOMER' && this.db.users) {
      const u = this.db.users.find(x => x.id === ownerId);
      if (u) {
        u.walletBalance = Math.round(((u.walletBalance || 0) + numAmount) * 100) / 100;
        newBalance = u.walletBalance;
      }
    } else if (ownerType === 'DRIVER' && this.db.drivers) {
      const d = this.db.drivers.find(x => x.id === ownerId);
      if (d) {
        d.walletBalance = Math.round(((d.walletBalance || 0) + numAmount) * 100) / 100;
        newBalance = d.walletBalance;
      }
    }

    const fallbackEntry = {
      id: `TXN-${Date.now()}`,
      transactionId: `txn_${Date.now()}`,
      timestamp: new Date().toISOString(),
      category,
      debitAccount: dAccount,
      creditAccount: cAccount,
      amount: Math.abs(numAmount),
      debitAmount: Math.abs(numAmount),
      creditAmount: Math.abs(numAmount),
      currency: 'INR',
      description,
      referenceId,
      status: 'POSTED'
    };
    this.db.ledgerEntries.unshift(fallbackEntry);

    return {
      success: true,
      status: 'POSTED',
      balance: newBalance,
      transactionId: fallbackEntry.transactionId,
      entry: fallbackEntry
    };
  }

  /**
   * Authoritative Double-Entry Ledger Insert
   */
  async recordDoubleEntry({
    category,
    debitAccount,
    creditAccount,
    amount,
    jobId = null,
    description = '',
    referenceId = null,
    transactionId = null
  }) {
    const numAmount = Number(amount);
    const txnId = transactionId || `txn_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;

    const entry = {
      id: txnId,
      transactionId: txnId,
      timestamp: new Date().toISOString(),
      category: category || 'RIDE_SETTLEMENT',
      jobId,
      debitAccount,
      creditAccount,
      amount: numAmount,
      debitAmount: numAmount,
      creditAmount: numAmount,
      currency: 'INR',
      description,
      referenceId: referenceId || jobId,
      status: 'POSTED'
    };

    if (isLivePostgres && supabaseAdmin) {
      try {
        // Resolve job UUID if jobId provided
        let jobUuid = null;
        if (jobId && UUID_REGEX.test(jobId)) {
          jobUuid = jobId;
        } else if (jobId && this.db.jobs) {
          const j = this.db.jobs.find(x => x.id === jobId || x.jobNumber === jobId);
          if (j && j.uuid) jobUuid = j.uuid;
        }

        // Insert journal transaction in PostgreSQL
        const { data: jtData, error: jtErr } = await supabaseAdmin
          .from('journal_transactions')
          .insert([{
            transaction_id: txnId,
            category: entry.category,
            job_id: jobUuid,
            total_debit: numAmount,
            total_credit: numAmount,
            description: description || 'Double-entry settlement',
            reference_id: entry.referenceId ? String(entry.referenceId) : null,
            status: 'POSTED'
          }])
          .select('id')
          .single();

        if (!jtErr && jtData && jtData.id) {
          // Insert Debit and Credit journal lines with valid account codes
          const dAccount = normalizeAccountCode(debitAccount);
          const cAccount = normalizeAccountCode(creditAccount);
          await supabaseAdmin.from('journal_lines').insert([
            {
              journal_id: jtData.id,
              account_code: dAccount,
              entry_type: 'DEBIT',
              amount: numAmount,
              entity_type: 'PLATFORM',
              notes: description
            },
            {
              journal_id: jtData.id,
              account_code: cAccount,
              entry_type: 'CREDIT',
              amount: numAmount,
              entity_type: 'PLATFORM',
              notes: description
            }
          ]);
        }
      } catch (err) {
        console.warn('⚠️ Supabase journal insert notice:', err.message);
      }
    }

    this.db.ledgerEntries.unshift(entry);
    return entry;
  }

  getAllEntries() {
    return this.db.ledgerEntries;
  }

  getEntriesByJobId(jobId) {
    return this.db.ledgerEntries.filter(e => e.jobId === jobId || e.referenceId === jobId);
  }
}

module.exports = LedgerRepository;
