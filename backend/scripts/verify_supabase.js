require('dotenv').config();
const { supabase, isConfigured, checkSupabaseConnection } = require('../src/supabase');

async function verify() {
  console.log('====================================================');
  console.log('🔍 NABIN PLATFORM — SUPABASE CONNECTION & SCHEMA CHECK');
  console.log('====================================================\n');

  if (!isConfigured) {
    console.log('❌ Supabase is NOT configured yet in backend/.env!');
    console.log('   Please set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in backend/.env\n');
    process.exit(1);
  }

  const health = await checkSupabaseConnection();
  console.log('Status Check:', health);

  if (!health.connected) {
    console.error('❌ Connection failed:', health.error || 'Unknown error');
    process.exit(1);
  }

  console.log('\n📊 Checking Tables & Record Counts:');
  const tables = [
    'profiles',
    'drivers',
    'merchants',
    'master_products',
    'merchant_inventory',
    'grocery_products',
    'grocery_price_history',
    'grocery_orders',
    'identity_applications',
    'audit_logs'
  ];

  for (const table of tables) {
    try {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`  ❌ ${table}: Error (${error.message}) — Table may not exist yet!`);
      } else {
        console.log(`  ✅ ${table}: Found (${count || 0} records)`);
      }
    } catch (err) {
      console.log(`  ❌ ${table}: ${err.message}`);
    }
  }

  console.log('\n🎉 Supabase setup verification complete!');
}

verify();
