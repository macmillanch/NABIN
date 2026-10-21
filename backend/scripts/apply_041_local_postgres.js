const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function applyLocalMigration() {
  const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  console.log(`Connecting to local PostgreSQL container: ${connectionString}...`);
  const client = new Client(connectionString);
  await client.connect();

  const migrationPath = path.resolve(__dirname, '../../supabase/migrations/041_restaurant_management_system_core.sql');
  console.log(`Reading local migration file: ${migrationPath}...`);
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Applying migration 041 to local PostgreSQL database...');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Migration 041 successfully applied to local PostgreSQL container!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to apply migration 041:', err);
    throw err;
  } finally {
    await client.end();
  }
}

applyLocalMigration().catch(err => {
  console.error('Migration error:', err.message);
  process.exit(1);
});
