/**
 * Applies a local migration SQL file to the local Docker PostgreSQL (127.0.0.1:54322).
 * LOCAL ONLY — remote Supabase is never touched (DEC-013).
 * Usage: node apply_local_migration.js supabase/migrations/023_financial_ledger_security_hardening.sql
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const file = process.argv[2];
if (!file) {
  console.error('Usage: node apply_local_migration.js <migration-file.sql>');
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query(sql);
    console.log(`✅ Applied migration: ${file}`);
  } catch (err) {
    console.error(`❌ Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
