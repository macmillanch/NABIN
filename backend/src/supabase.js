require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('your-project-id') && 
  !supabaseAnonKey.includes('your-supabase')
);

let supabase = null;
let supabaseAdmin = null;

if (isConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
    console.log('✅ Supabase Client initialized successfully with URL:', supabaseUrl);
  } catch (err) {
    console.warn('⚠️ Error initializing Supabase client:', err.message);
  }
} else {
  console.log('ℹ️ Supabase environment variables not configured. Backend operating in local memory DB mode.');
}

/**
 * Helper to check connection health with Supabase DB
 */
async function checkSupabaseConnection() {
  if (!isConfigured || !supabase) {
    return { configured: false, connected: false, mode: 'LOCAL_MEMORY' };
  }
  try {
    const { data, error } = await supabase.from('grocery_products').select('count', { count: 'exact', head: true });
    if (error) {
      return { configured: true, connected: false, error: error.message, mode: 'LOCAL_MEMORY_FALLBACK' };
    }
    return { configured: true, connected: true, mode: 'SUPABASE_LIVE', productCount: data };
  } catch (e) {
    return { configured: true, connected: false, error: e.message, mode: 'LOCAL_MEMORY_FALLBACK' };
  }
}

module.exports = {
  supabase,
  supabaseAdmin,
  isConfigured,
  checkSupabaseConnection
};
