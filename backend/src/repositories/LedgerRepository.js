const { supabaseAdmin, isConfigured } = require('../supabase');

class LedgerRepository {
  constructor(db) {
    this.db = db;
  }

  async recordDoubleEntry({ category, debitAccount, creditAccount, amount, jobId = null, description = '', referenceId = null }) {
    const entry = {
      id: `LEDGER-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      timestamp: new Date().toISOString(),
      category,
      jobId,
      debitAccount,
      creditAccount,
      debitAmount: Number(amount),
      creditAmount: Number(amount),
      currency: 'INR',
      description,
      referenceId,
      status: 'POSTED'
    };

    this.db.ledgerEntries.push(entry);
    this.db.save();

    if (isConfigured && supabaseAdmin) {
      try {
        await supabaseAdmin.from('ledger_entries').insert([{
          entry_id: entry.id,
          category: entry.category,
          debit_account: entry.debitAccount,
          credit_account: entry.creditAccount,
          amount: entry.debitAmount,
          currency: entry.currency,
          description: entry.description,
          reference_id: entry.referenceId,
          created_at: entry.timestamp
        }]);
      } catch (err) {
        console.warn('⚠️ Supabase ledger insert sync notice:', err.message);
      }
    }

    return entry;
  }

  getAllEntries() {
    return this.db.ledgerEntries;
  }

  getEntriesByJobId(jobId) {
    return this.db.ledgerEntries.filter(e => e.jobId === jobId);
  }
}

module.exports = LedgerRepository;
