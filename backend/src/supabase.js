const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Guarantee WebSocket global for Supabase Realtime compatibility
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('your-project-id') && 
  !supabaseAnonKey.includes('your-supabase')
);

const isLivePostgres = Boolean(isConfigured && (process.env.SUPABASE_POSTGRES_LIVE === 'true' || process.env.NODE_ENV === 'production'));

// PRODUCTION FAIL-CLOSED GUARD
if (process.env.NODE_ENV === 'production' && !isConfigured) {
  const fatalMsg = 'FATAL DATABASE ERROR: In production mode (NODE_ENV=production), valid SUPABASE_URL and SUPABASE_ANON_KEY must be configured. Backend will FAIL CLOSED rather than use unpersisted memory or local files.';
  console.error(`🚨 ${fatalMsg}`);
  throw new Error(fatalMsg);
}

let supabase = null;
let supabaseAdmin = null;

if (isConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
    console.log('✅ Supabase PostgreSQL Client initialized successfully with URL:', supabaseUrl);
  } catch (err) {
    console.error('⚠️ Error initializing Supabase client:', err.message);
    if (process.env.NODE_ENV === 'production') {
      throw err;
    }
  }
} else {
  console.log('ℹ️ Supabase environment variables not configured. Operating in development mode.');
}

/**
 * Authoritative Readiness & DB Health Check
 */
async function checkSupabaseConnection() {
  if (!isConfigured || !supabase) {
    if (process.env.NODE_ENV === 'production') {
      return { configured: false, connected: false, ready: false, mode: 'PRODUCTION_UNCONFIGURED_ERROR' };
    }
    return { configured: false, connected: true, ready: true, mode: 'DEVELOPMENT_LOCAL_MODE' };
  }
  try {
    const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
    if (error) {
      return { configured: true, connected: false, ready: false, error: error.message, mode: 'POSTGRES_DISCONNECTED' };
    }
    return { configured: true, connected: true, ready: true, mode: 'SUPABASE_POSTGRES_LIVE', userCount: data };
  } catch (e) {
    return { configured: true, connected: false, ready: false, error: e.message, mode: 'POSTGRES_ERROR' };
  }
}

module.exports = {
  supabase,
  supabaseAdmin,
  isConfigured,
  isLivePostgres,
  checkSupabaseConnection
};
