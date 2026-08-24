const fs = require('fs');
const path = require('path');
const { supabaseAdmin, isConfigured } = require('../supabase');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

class PersistentStore {
  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    if (!this.isProduction) {
      this.ensureDataDir();
    }
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
    // 1. In production, PostgreSQL is mandatory
    if (this.isProduction) {
      if (!isConfigured || !supabaseAdmin) {
        throw new Error('FATAL DATABASE ERROR: Production requires active PostgreSQL / Supabase connection.');
      }
      return null;
    }

    // 2. In development / test, load from local storage
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
    // In production, enforce database persistence; do not write local json
    if (this.isProduction) {
      this.syncToPostgres(state);
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
      ledgerEntries: state.ledgerEntries || [],
      paymentSessions: Array.from((state.paymentSessions || new Map()).entries()),
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

  async syncToPostgres(state) {
    if (!isConfigured || !supabaseAdmin) return;
    try {
      // Async sync of critical business entities to Supabase
      if (state.jobs && state.jobs.length) {
        const latestJob = state.jobs[0];
        if (latestJob) {
          await supabaseAdmin.from('jobs').upsert([{
            job_number: latestJob.id,
            service_type: latestJob.type || 'RIDE',
            status: latestJob.status,
            pickup_address: latestJob.pickup?.address || 'Pickup',
            drop_address: latestJob.drop?.address || 'Drop',
            final_total: latestJob.fare || 0,
            driver_earnings: latestJob.driverEarnings || 0,
            platform_commission: latestJob.platformFee || 0
          }], { onConflict: 'job_number' }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('⚠️ Supabase background sync notice:', e.message);
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
