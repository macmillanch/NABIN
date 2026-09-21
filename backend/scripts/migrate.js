/**
 * Idempotent PostgreSQL migration runner for NABIN.
 *
 * Applies supabase/migrations/NNN_name.sql in version order against DATABASE_URL,
 * recording each applied version in supabase_migrations.schema_migrations so the
 * Supabase CLI sees the same ledger this script maintains.
 *
 * Safe to run on every container start: a session-level advisory lock serialises
 * concurrent runners, and applied versions are skipped.
 *
 * Usage: DATABASE_URL=postgresql://... node scripts/migrate.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Local convenience only: platform-injected env vars always win over .env.
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const LOCK_KEY = 'nabin_migrations';
const LOCK_WAIT_MS = 60000;
const LOCK_POLL_MS = 2000;

function migrationsDir() {
  return path.resolve(process.env.MIGRATIONS_DIR || path.join(__dirname, '..', '..', 'supabase', 'migrations'));
}

// node-postgres ignores an `sslmode` query parameter, so TLS is decided here.
// DATABASE_SSL=disable|no-verify|require overrides host detection; hosted projects
// verify certificates by default.
const LOCAL_HOST_PATTERN = /(?:^|@)(?:localhost|127\.0\.0\.1|::1|0\.0\.0\.0|host\.docker\.internal|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/i;

function sslConfig(connectionString) {
  const mode = (process.env.DATABASE_SSL || '').toLowerCase();
  if (mode === 'disable' || mode === 'false') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  if (mode) return { rejectUnauthorized: true };
  return LOCAL_HOST_PATTERN.test(connectionString) ? false : { rejectUnauthorized: true };
}

function discover(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      version: file.slice(0, 3),
      name: file.slice(4, file.length - 4),
      filePath: path.join(dir, file)
    }));
}

async function acquireLock(client, deadline) {
  for (;;) {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [LOCK_KEY]);
    if (rows[0].locked) return true;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${LOCK_WAIT_MS}ms waiting for the migration lock; another instance is migrating.`);
    }
    console.log('⏳ Migration lock held by another instance, retrying...');
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

// Connection errors from node-postgres can arrive without a message, so surface the
// driver code and the target host (credentials stripped) to make a failed deploy
// diagnosable from the log alone.
function describeError(err, connectionString) {
  const host = String(connectionString || '').replace(/\/\/[^@]*@/, '//').replace(/:[^:@]*(?=@)/, '');
  const detail = err?.message || err?.code || (err ? require('util').inspect(err) : 'unknown error');
  return `${detail} (target: ${host})`;
}

(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL is not set. Migrations cannot run without a PostgreSQL connection string.');
    process.exit(1);
  }

  const pendingPreview = discover(migrationsDir());
  const client = new Client({ connectionString, ssl: sslConfig(connectionString) });
  try {
    await client.connect();
  } catch (err) {
    console.error(`❌ Could not connect to PostgreSQL: ${describeError(err, connectionString)}`);
    process.exit(1);
  }

  let applied = 0;
  let skipped = 0;

  try {
    await acquireLock(client, Date.now() + LOCK_WAIT_MS);

    await client.query(`
      CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version text PRIMARY KEY,
        statements text[],
        name text
      );
    `);

    const { rows } = await client.query('SELECT version FROM supabase_migrations.schema_migrations');
    const done = new Set(rows.map((row) => row.version));

    for (const migration of pendingPreview) {
      if (done.has(migration.version)) {
        skipped += 1;
        continue;
      }

      const sql = fs.readFileSync(migration.filePath, 'utf8');
      // One transaction per file: a failing migration leaves no partial schema behind.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
          [migration.version, [], migration.name]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.version}_${migration.name} failed: ${err.message}`);
      }

      applied += 1;
      console.log(`✅ Applied ${migration.version}_${migration.name}`);
    }

    const { rows: remaining } = await client.query(
      'SELECT count(*)::int AS live FROM supabase_migrations.schema_migrations'
    );
    console.log(`📋 Migrations up to date: ${applied} applied, ${skipped} already recorded, ${remaining[0].live} total in ledger.`);
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
})().catch((err) => {
  console.error(`❌ ${describeError(err, process.env.DATABASE_URL)}`);
  process.exit(1);
});
