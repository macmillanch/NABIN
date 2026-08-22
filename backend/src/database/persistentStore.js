const fs = require('fs');
const path = require('path');
const { supabase } = require('../supabase');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

class PersistentStore {
  constructor() {
    this.ensureDataDir();
    this.writeDebounceTimer = null;
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
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        console.log(`💾 Loaded persistent state from disk (${parsed.jobs?.length || 0} jobs, ${parsed.ledgerEntries?.length || 0} ledger entries).`);
        return parsed;
      } catch (err) {
        console.warn('⚠️ Could not parse persistent store on disk, using clean initialized state:', err.message);
      }
    }
    return null;
  }

  saveStateSync(state) {
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
      ledgerEntries: state.ledgerEntries || [],
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
      console.error('❌ Error persisting state to disk:', err.message);
    }
  }

  scheduleSave(state) {
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
    }
    this.writeDebounceTimer = setTimeout(() => {
      this.saveStateSync(state);
    }, 150);
  }
}

module.exports = new PersistentStore();
