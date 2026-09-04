const fs = require('fs');
const path = require('path');
const { supabaseAdmin, isConfigured, isLivePostgres } = require('../supabase');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

class PersistentStore {
  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    this.writeDebounceTimer = null;
    if (!this.isProduction && !isLivePostgres) {
      this.ensureDataDir();
    }
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.warn('⚠️ Could not create persistent data directory:', err.message);
      }
    }
  }

  loadState() {
    // 1. In production or when SUPABASE_POSTGRES_LIVE=true, PostgreSQL is authoritative
    if (this.isProduction || isLivePostgres) {
      if (this.isProduction && (!isConfigured || !supabaseAdmin)) {
        throw new Error('FATAL DATABASE ERROR: Production requires active PostgreSQL / Supabase connection.');
      }
      // PostgreSQL is authoritative; do not load competing JSON state
      return null;
    }

    // 2. Only in isolated offline development without PostgreSQL, load from store.json
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        console.log(`💾 Loaded persistent state (${parsed.jobs?.length || 0} jobs, ${parsed.ledgerEntries?.length || 0} ledger entries).`);
        return parsed;
      } catch (err) {
        console.warn('⚠️ Could not parse local store, using clean initialized state:', err.message);
      }
    }
    return null;
  }

  saveStateSync(state) {
    // When PostgreSQL is authoritative, never write competing authoritative JSON state
    if (this.isProduction || isLivePostgres) {
      return;
    }

    this.ensureDataDir();
    const serialized = {
      users: state.users || [],
      drivers: state.drivers || [],
      restaurants: state.restaurants || [],
      groceryCatalog: state.groceryCatalog || [],
      jobs: state.jobs || [],
      supportTickets: state.supportTickets || [],
      identityApplications: state.identityApplications || [],
      geoFences: state.geoFences || [],
      surgeRules: state.surgeRules || [],
      promotions: state.promotions || [],
      adminAccounts: state.adminAccounts || [],
      adminUsers: state.adminUsers || [],
      ledgerEntries: state.ledgerEntries || [],
      paymentSessions: Array.from((state.paymentSessions || new Map()).entries()),
      mediaAssets: state.mediaAssets || [],
      processedWebhookIds: Array.from(state.processedWebhookIds || []),
      processedPaymentIds: Array.from(state.processedPaymentIds || []),
      auditLogs: state.auditLogs || [],
      featureFlags: Array.from((state.featureFlags || new Map()).entries()),
      savedAt: new Date().toISOString()
    };

    const tempPath = `${STORE_PATH}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(serialized, null, 2), 'utf8');
      fs.renameSync(tempPath, STORE_PATH);
    } catch (err) {
      console.error('❌ Error persisting local state to disk:', err.message);
    }
  }

  scheduleSave(state) {
    if (this.isProduction || isLivePostgres) {
      return;
    }
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
    }
    this.writeDebounceTimer = setTimeout(() => {
      this.saveStateSync(state);
    }, 150);
  }
}

module.exports = new PersistentStore();
