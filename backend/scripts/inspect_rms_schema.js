'use strict';
const { Pool } = require('pg');

async function inspect() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  const tables = ['orders', 'restaurant_tables', 'restaurant_table_sessions', 'restaurant_bills', 'restaurant_kds_tickets', 'restaurant_staff', 'merchants'];
  for (const t of tables) {
    const res = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [t]
    );
    console.log(`\n=== TABLE: ${t} ===`);
    console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
  }
  await pool.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
