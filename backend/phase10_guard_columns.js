// Phase 10 audit helper: verify users/drivers/merchants column names used by the
// migration-024 privileged-column guard, and confirm no target column is missing.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const EXPECTED = {
  users: ['id', 'phone', 'wallet_balance', 'identity_status', 'account_status'],
  drivers: ['id', 'user_id', 'phone', 'wallet_balance', 'kyc_status',
    'operational_status', 'license_number', 'vehicle_number',
    'verified_upi_id', 'pending_upi_id', 'payout_upi_verified',
    'payout_upi_verified_at', 'vpa_verification_method',
    'upi_cooling_until', 'kyc_verified_at', 'kyc_rejected_reason'],
  merchants: ['id', 'wallet_balance', 'commission_rate', 'merchant_type', 'fssai_license']
};

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  let problems = 0;

  for (const [table, cols] of Object.entries(EXPECTED)) {
    const res = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    const actual = new Set(res.rows.map(r => r.column_name));
    const missing = cols.filter(x => !actual.has(x));
    console.log(`${table}: ${cols.length - missing.length}/${cols.length} guard columns present`);
    if (missing.length) {
      problems += missing.length;
      console.log(`  MISSING -> ${missing.join(', ')}`);
      console.log(`  available: ${[...actual].join(', ')}`);
    }
  }

  console.log(problems === 0 ? '\nGUARD_COLUMNS_OK' : `\nGUARD_COLUMNS_PROBLEMS=${problems}`);
  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });