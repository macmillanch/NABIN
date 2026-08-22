class LedgerRepository {
  constructor(db) {
    this.db = db;
  }

  recordDoubleEntry({ category, debitAccount, creditAccount, amount, jobId = null, description = '', referenceId = null }) {
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
