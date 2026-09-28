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
  /**
   * E2: the durable record of an operation, addressed by its idempotency key.
   *
   * Two filtered reads rather than one embedded join: `journal_lines.journal_id` is a real foreign
   * key, but an embed depends on PostgREST's relationship cache and this sits on the money path.
   * Returns null when the key has not been used, which is the normal case.
   */
  async findOperationByKey(idempotencyKey) {
    if (!idempotencyKey || !isLivePostgres || !supabaseAdmin) return null;
    const txn = await supabaseAdmin.from('journal_transactions')
      .select('id, transaction_id, category, total_credit, total_debit, reference_id')
      .eq('idempotency_key', String(idempotencyKey)).maybeSingle();
    if (txn.error || !txn.data) return null;
    const lines = await supabaseAdmin.from('journal_lines')
      .select('account_code, entry_type, amount, entity_type, entity_id')
      .eq('journal_id', txn.data.id);
    return { txn: txn.data, lines: (!lines.error && lines.data) || [] };
  }

  /**
   * The attributes that make an operation itself: how much, to whom, from and to which accounts,
   * under which ledger category, against which business reference. `description` is deliberately
   * NOT compared — it is narration, and two callers describing one movement differently is not two
   * movements. Returns the mismatches found; empty means the request truly replays the stored one.
   */
  operationMismatch(existing, requested) {
    const problems = [];
    if (!existing || !existing.txn) return problems;
    const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
    const want = money(Math.abs(Number(requested.amount) || 0));
    if (money(existing.txn.total_credit) !== want || money(existing.txn.total_debit) !== want) {
      problems.push(`amount ${money(existing.txn.total_credit)}/${money(existing.txn.total_debit)} `
        + `is already booked, this request says ${want}`);
    }
    if (existing.txn.category && requested.category && existing.txn.category !== requested.category) {
      problems.push(`category ${existing.txn.category} is already booked, this request says ${requested.category}`);
    }
    const debit = (existing.lines || []).find(l => l.entry_type === 'DEBIT');
    const credit = (existing.lines || []).find(l => l.entry_type === 'CREDIT');
    if (debit && requested.debitAccount && debit.account_code !== requested.debitAccount) {
      problems.push(`debit account ${debit.account_code} is already booked, this request says ${requested.debitAccount}`);
    }
    if (credit && requested.creditAccount && credit.account_code !== requested.creditAccount) {
      problems.push(`credit account ${credit.account_code} is already booked, this request says ${requested.creditAccount}`);
    }
    const owned = (existing.lines || []).filter(l => l.entity_type && l.entity_id);
    if (owned.length && requested.ownerUuid) {
      const sameOwner = owned.every(l => String(l.entity_type).toUpperCase() === String(requested.ownerType || '').toUpperCase()
        && String(l.entity_id).toLowerCase() === String(requested.ownerUuid).toLowerCase());
      if (!sameOwner) {
        problems.push(`booked against ${owned[0].entity_type}:${owned[0].entity_id}, `
          + `this request names ${requested.ownerType}:${requested.ownerUuid}`);
      }
    }
    if (existing.txn.reference_id !== null && existing.txn.reference_id !== undefined
      && requested.referenceId !== null && requested.referenceId !== undefined
      && String(existing.txn.reference_id) !== String(requested.referenceId)) {
      problems.push(`reference ${existing.txn.reference_id} is already booked, this request says ${requested.referenceId}`);
    }
    return problems;
  }

  /** A conflict is its own outcome: typed, refused, and provably before any movement. */
  idempotencyConflict(idempotencyKey, problems) {
    const err = new Error(`Idempotency key "${idempotencyKey}" is already used by a different `
      + `operation (${problems.join('; ')}). This request moved nothing and booked nothing.`);
    err.code = 'IDEMPOTENCY_CONFLICT';
    err.status = 409;
    err.statusCode = 409;
    return err;
  }

  /**
   * What a true replay reports: this caller's operation is the one already committed, so it gets
   * the authoritative balance and the existing transaction id. Refreshing the cache from a durable
   * read is the same behaviour the concurrent-collision path has always had.
   */
  async duplicateResultFor(ownerType, ownerUuid, ownerId, existing) {
    const balanceTable = ownerType === 'CUSTOMER' ? 'users'
      : ownerType === 'DRIVER' ? 'drivers' : 'merchants';
    const current = await supabaseAdmin.from(balanceTable)
      .select('wallet_balance').eq('id', ownerUuid).maybeSingle();
    const balance = !current.error && current.data ? current.data.wallet_balance : undefined;
    if (balance !== undefined && this.db) {
      const cached = ownerType === 'CUSTOMER' ? this.db.getUser?.(ownerId)
        : ownerType === 'DRIVER' ? this.db.getDriver?.(ownerId) : null;
      if (cached) cached.walletBalance = Number(balance);
    }
    return {
      success: true,
      status: 'IDEMPOTENT_SKIPPED',
      duplicate: true,
      entry: null,
      balance,
      transactionId: existing && existing.txn ? existing.txn.transaction_id : undefined
    };
  }

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
      /* E2: an idempotency key names ONE operation. Until now a reused key was treated as a
       * duplicate purely because a row existed, so a request carrying a different amount, a
       * different owner, a different posting account or a different category was swallowed as
       * "already done": no money moved (the UNIQUE index guarantees that much) but the caller was
       * told its own operation had been handled. Silence in place of a refusal is how a mis-keyed
       * integration loses money without ever noticing. The comparison reads only rows PostgreSQL
       * already holds immutably, so no schema change and no new state is involved. */
      const seen = await this.findOperationByKey(idempotencyKey);
      if (seen) {
        const problems = this.operationMismatch(seen, {
          amount: numAmount, category, debitAccount: dAccount, creditAccount: cAccount,
          ownerType, ownerUuid, referenceId
        });
        if (problems.length) throw this.idempotencyConflict(idempotencyKey, problems);
        const replay = await this.duplicateResultFor(ownerType, ownerUuid, ownerId, seen);
        if (replay) return replay;
      }

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
        /* Two callers that both cleared the read-check race in PostgreSQL: the UNIQUE
         * idempotency_key index decides, and the loser has moved no money. The SQLSTATE alone is
         * not enough, because `adjust_wallet_atomic` re-raises the violation from its own handler
         * and PostgREST then reports a generic code with the original text - so a collision was
         * previously thrown out unclassified (`PostgreSQL adjust_wallet_atomic failed: …`) instead
         * of being reported as the duplicate/conflict it is. Matching the message is restricted to
         * the idempotency constraint on purpose: any other unique violation must stay an error. */
        const idempotencyCollision = error.code === '23505'
          || (/duplicate key value/i.test(String(error.message || ''))
            && /idempotency_key/i.test(String(error.message || '')));
        if (idempotencyCollision && idempotencyKey) {
          // Two requests raced to the same key. The constraint decided which one moved money and
          // the loser has moved none, but "same key" is only a duplicate if it is the same
          // operation: the loser's own request is compared against what the winner committed, and
          // a different amount/owner/account/category is a conflict, not a success. The pre-flight
          // above normally catches this first; this covers the window between that read and the
          // insert, which is exactly when a concurrent pair would disagree.
          const raced = await this.findOperationByKey(idempotencyKey);
          if (raced) {
            const problems = this.operationMismatch(raced, {
              amount: numAmount, category, debitAccount: dAccount, creditAccount: cAccount,
              ownerType, ownerUuid, referenceId
            });
            if (problems.length) throw this.idempotencyConflict(idempotencyKey, problems);
          }
          // The loser must still be able to report the operation's result, so read the balance
          // the winner's commit produced. Without this a caller can only see "skipped" and has
          // nothing to answer the client with — which is how a lost-response retry ends up
          // looking like a failure and getting attempted again. `adjust_wallet_atomic` already
          // does exactly this on its own in-function idempotency branch; this is the same
          // behaviour on the concurrent-collision path, with the same table mapping.
          const balanceTable = ownerType === 'CUSTOMER' ? 'users'
            : ownerType === 'DRIVER' ? 'drivers' : 'merchants';
          const current = await supabaseAdmin.from(balanceTable)
            .select('wallet_balance').eq('id', ownerUuid).maybeSingle();
          const balance = !current.error && current.data ? current.data.wallet_balance : undefined;
          if (balance !== undefined && this.db) {
            // Cache refresh only: this is the value PostgreSQL holds, read after its commit.
            const cached = ownerType === 'CUSTOMER' ? this.db.getUser?.(ownerId)
              : ownerType === 'DRIVER' ? this.db.getDriver?.(ownerId) : null;
            if (cached) cached.walletBalance = Number(balance);
          }
          return {
            success: true,
            status: 'IDEMPOTENT_SKIPPED',
            duplicate: true,
            entry: null,
            balance
          };
        }
        throw new Error(`PostgreSQL adjust_wallet_atomic failed: ${error.message}`);
      }

      if (!data || !data.success) {
        throw new Error(`adjust_wallet_atomic returned unsuccessful: ${JSON.stringify(data)}`);
      }

      // The RPC answers IDEMPOTENT_SKIPPED from its own key lookup, which compares nothing. Money
      // did not move either way, so this is purely about not reporting someone else's operation as
      // this one's: compare, and refuse when the stored operation is not the requested one.
      if (data.status === 'IDEMPOTENT_SKIPPED' && idempotencyKey) {
        const raced = await this.findOperationByKey(idempotencyKey);
        if (raced) {
          const problems = this.operationMismatch(raced, {
            amount: numAmount, category, debitAccount: dAccount, creditAccount: cAccount,
            ownerType, ownerUuid, referenceId
          });
          if (problems.length) throw this.idempotencyConflict(idempotencyKey, problems);
        }
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
      if (data.status !== 'IDEMPOTENT_SKIPPED') {
        // Only a booked movement belongs in the ledger view. Adding an entry for an operation
        // PostgreSQL refused as a duplicate would double the trail's claim about money that
        // moved once.
        this.db.ledgerEntries.unshift(journalEntry);
      }

      return {
        success: true,
        status: data.status,
        duplicate: data.status === 'IDEMPOTENT_SKIPPED',
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
    transactionId = null,
    idempotencyKey = null
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
            idempotency_key: idempotencyKey ? String(idempotencyKey) : null,
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

        // journal_transactions.idempotency_key is UNIQUE in the database, so a
        // collision is PostgreSQL refusing a second booking of the same movement.
        // That is the answer the caller needs, not an error to swallow: the
        // in-memory ledger must not record it either.
        if (jtErr && jtErr.code === '23505' && idempotencyKey) {
          return { duplicate: true, idempotencyKey: String(idempotencyKey), transactionId: txnId };
        }

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
