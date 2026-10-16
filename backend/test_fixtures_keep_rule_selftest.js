/*
 * F-C1-4 REGRESSION SELFTEST - fixture cleanup must not reap money rows whose ledger cannot follow.
 *
 * The measured defect (read-only evidence: backend/scratch/review_20261016_c1/fc14_*.log, 2026-10-16,
 * local Docker `public`, role `postgres`):
 *
 *   - 13 tables hang off `users` by a single-column FK. Two of them are money: `payments` and
 *     `payment_sessions`, both `customer_id -> users(id)` with NO ACTION, and each carries only a
 *     BEFORE UPDATE trigger - no BEFORE DELETE - so cleanup() deleted them like any other child.
 *   - `ledger_entries` (1041 rows), `journal_transactions` (5195) and `journal_lines` (10384) carry
 *     `prevent_financial_row_mutation()` on BEFORE DELETE OR UPDATE, which RAISEs for every role
 *     including `postgres`. They cannot be reaped. `ledger_entries` and `journal_transactions` point
 *     only at `jobs(job_id)` and `journal_lines` only at its journal and `ledger_accounts`, so no
 *     ledger or journal column names a `payments` row: PostgreSQL cannot refuse the money delete on
 *     the ledger's behalf - while a journaled settlement and its payment DO share that `job_id`. Reaping
 *     the money leaves a half-reaped double-entry ledger.
 *   - Exactly one append-only table can protect the money, and it protects a subset:
 *     `payment_refund_authorizations.payment_id -> payments(payment_id)` (varchar business key,
 *     NO ACTION). A payment with a refund authorization cannot be deleted; one without it can. That
 *     is FKP-10 and FKP-12 below, executed rather than asserted from the catalog.
 *
 * The rule under test (backend/test_fixtures.js, KEPT_FINANCIAL): those two tables are skipped by
 * name in cleanup()'s discovery loop, the kept rows are counted and reported under `kept`, and a
 * fixture customer that owns money is kept with it, because a kept payment with a deleted owner is
 * worse than residue - it is money with no owner.
 *
 * How this proves it without touching shared data - `public` is READ, never written:
 *   - every row lives in a disposable schema (`nabin_fixture_keep_probe_a/b`) whose tables are cloned
 *     from `public` definitions, with PK/UNIQUE/CHECK/FK replayed and its DELETE-covering triggers
 *     recreated from `pg_get_triggerdef` onto the clone;
 *   - every seed row is a COPY of a real `public` row, with overrides only for the primary key, the
 *     single-column UNIQUE keys, and the FK columns that must point at clone rows. No column VALUE is
 *     invented, so no CHECK enum in this file is a guess (the measured shape that makes this possible
 *     is scratch/review_20261016_c1/fc14_seedfk.log);
 *   - the undeletability claim is executed against a CLONE row, because a DELETE whose WHERE clause
 *     matches no row never fires a BEFORE trigger and would prove nothing;
 *   - the pre-fix delete order is replicated inside a transaction that always ROLLBACKs;
 *   - the schemas the clone does NOT carry are reported (FK-replay skips, INSERT/UPDATE-only
 *     triggers, row-level security) instead of being silently assumed.
 *
 * Local/test only. Refuses an undeclared or non-loopback target the same way the helper does, and
 * refuses to start if its probe schemas already exist.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BACKEND = __dirname;
const fxModule = require(path.join(BACKEND, 'test_fixtures'));
const targetGuard = require(path.join(BACKEND, 'scripts', 'chain_target_guard'));

const PROBE_A = 'nabin_fixture_keep_probe_a';
const PROBE_B = 'nabin_fixture_keep_probe_b';

// The cleanup reach: every table the fixture creators write into, every table cleanup() names by
// hand, every FK parent those names depend on, and the money/audit tables this finding is about.
// A subset of `public` by design - FKP-05 proves the hand-named half is complete, so a missing table
// cannot quietly turn a delete into a no-op.
const TABLES = ['users', 'merchants', 'jobs', 'drivers', 'products', 'checkouts', 'orders',
  'order_lines', 'order_transitions', 'order_creation_tokens', 'checkout_events',
  'restaurant_kds_tickets', 'restaurant_tables', 'restaurant_table_sessions', 'restaurant_staff',
  'payments', 'payment_sessions', 'payment_webhooks', 'payment_refund_authorizations',
  'ledger_entries', 'ledger_accounts', 'journal_transactions', 'journal_lines',
  'audit_logs', 'driver_payouts', 'backend_sessions', 'promotions', 'promotion_redemptions',
  'master_grocery_catalog', 'merchant_grocery_inventory', 'grocery_price_history',
  'identity_documents', 'saved_children', 'saved_schools', 'user_delegates',
  'user_saved_locations', 'support_tickets', 'advertisements', 'dark_stores', 'campaigns'];

// Tables whose public guard refuses a DELETE for EVERY role. Cloned with their triggers, so the
// refusal is executed against the real guard function on a row that exists.
const APPEND_ONLY = ['ledger_entries', 'journal_transactions', 'journal_lines', 'audit_logs',
  'driver_payouts', 'payment_webhooks', 'payment_refund_authorizations'];

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const assertIdent = (v, what) => {
  if (!IDENT.test(v)) {
    throw new Error(`F-C1-4 selftest REFUSED: unsafe ${what} ${JSON.stringify(String(v).slice(0, 60))}`);
  }
  return v;
};
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
// The redirection idiom chain_scratch.js already proves works against this store: the raw string is
// extended, never re-encoded through URLSearchParams, because the value libpq must see is
// `-c search_path=<schema>`.
const withSearchPath = (url, schema) =>
  `${url}${url.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schema}`;

// ---------------------------------------------------------------- catalog reads

// The column shape of a `public` table: name, type, whether it is NOT NULL *and* has no default, and
// whether it is generated or identity (those two cannot be written, so they are dropped from a copy).
async function columnsOf(client, table) {
  const { rows } = await client.query(`
    SELECT att.attname::text name, fmt.typname::text type,
           (att.attnotnull AND att.atthasdef = false) nn,
           att.attgenerated::text gen, att.attidentity::text ident
      FROM pg_class rel
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace AND ns.nspname = 'public'
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum > 0 AND NOT att.attisdropped
      JOIN pg_type fmt ON fmt.oid = att.atttypid
     WHERE rel.relkind = 'r' AND rel.relname::text = $1
     ORDER BY att.attnum`, [table]);
  return rows;
}

// Every non-internal trigger on a `public` table, DELETE-covering or not, so the clone can state
// exactly which guards it carries and which it deliberately does not.
async function triggersOf(client, table) {
  const { rows } = await client.query(`
    SELECT tg.tgname::text name, pg_get_triggerdef(tg.oid) def
      FROM pg_trigger tg
      JOIN pg_class rel ON rel.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace AND ns.nspname = 'public'
     WHERE rel.relname::text = $1 AND NOT tg.tgisinternal
     ORDER BY tg.tgname`, [table]);
  return rows;
}

// The FK map of a `public` table, per column: what a copy of a row must re-anchor or null out.
async function foreignKeysOf(client, table) {
  const { rows } = await client.query(`
    SELECT att.attname::text col, rel.relname::text parent, rel.relrowsecurity parent_rls
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid AND src.relname::text = $1
      JOIN pg_class rel ON rel.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = src.relnamespace AND ns.nspname = 'public'
      JOIN pg_attribute att ON att.attrelid = src.oid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1`, [table]);
  return rows;
}

// ---------------------------------------------------------------- clone

async function cloneSchema(client, schema) {
  assertIdent(schema, 'schema');
  const present = new Set((await client.query(
    `SELECT relname::text t FROM pg_class JOIN pg_namespace n ON n.oid = relnamespace
      WHERE relkind='r' AND n.nspname='public'`)).rows.map((r) => r.t));
  const tables = TABLES.filter((t) => present.has(t));
  const absent = TABLES.filter((t) => !present.has(t));
  await client.query(`CREATE SCHEMA ${schema}`);
  for (const t of tables) {
    assertIdent(t, 'table');
    await client.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING DEFAULTS)`);
  }
  // Constraints after every table exists, so an FK cycle cannot stall the clone. Two passes, because
  // an FK can only be added once the UNIQUE it points at exists: pass 1 lays every PK/UNIQUE/CHECK,
  // pass 2 every FK, in table order rather than dependency order. `confrelid` is 0 on a PK/UNIQUE/CHECK,
  // so the parent join is a LEFT JOIN - an inner join here silently drops every key constraint and the
  // first FK then fails with 42830. An FK whose parent is not part of the CLONE is skipped and counted -
  // the clone is a subset by design, and a skipped FK only ever makes the clone LESS restrictive than
  // public, never more.
  let applied = 0;
  const skippedFks = [];
  const cloned = new Set(tables);
  const constraints = new Map();
  for (const t of tables) {
    constraints.set(t, (await client.query(`
      SELECT con.conname::text con, con.contype typ, pg_get_constraintdef(con.oid) def,
             COALESCE(rel.relname::text, '') parent
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid AND src.relname::text = $1
        LEFT JOIN pg_class rel ON rel.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = src.relnamespace AND ns.nspname = 'public'
       WHERE con.contype IN ('p', 'u', 'c', 'f')`, [t])).rows);
  }
  for (const pass of ['p', 'u', 'c', 'f']) {
    for (const t of tables) {
      for (const c of constraints.get(t)) {
        if (c.typ !== pass) continue;
        assertIdent(c.con, 'constraint');
        if (c.typ === 'f' && !cloned.has(c.parent)) { skippedFks.push(`${t}.${c.con}->${c.parent}`); continue; }
        const def = c.typ === 'f'
          ? c.def.replace(/REFERENCES (?:public\.)?"?([a-z_][a-z0-9_]*)"?/i,
            (m, name) => `REFERENCES ${schema}.${assertIdent(name, 'table')}`)
          : c.def;
        await client.query(`ALTER TABLE ${schema}.${t} ADD CONSTRAINT ${c.con} ${def}`);
        applied += 1;
      }
    }
  }
  // The DELETE-covering guards, recreated on the clone's own rows. `pg_get_triggerdef` writes the
  // source schema into ON <schema>.<table> and leaves the function unqualified, so both halves are
  // re-anchored here: the target to the clone, the function to public (where it lives). Triggers that
  // only cover INSERT/UPDATE are NOT recreated - the clone would then refuse writes public permits -
  // and the omission is reported rather than assumed harmless.
  let recreated = 0;
  const omitted = [];
  const rls = [];
  for (const t of tables) {
    for (const tg of await triggersOf(client, t)) {
      if (!/DELETE/i.test(tg.def)) { omitted.push(`${t}.${tg.name}`); continue; }
      assertIdent(tg.name, 'trigger');
      const def = tg.def
        .replace(new RegExp(`^CREATE(\\s+CONSTRAINT)?\\s+TRIGGER\\s+"?${tg.name}"?\\s+`, 'i'),
          `CREATE TRIGGER ${tg.name} `)
        .replace(/ON (?:public\.)?"?[a-z_][a-z0-9_]*"?/i, `ON ${schema}.${t}`)
        .replace(/EXECUTE (?:FUNCTION|PROCEDURE)\s+([a-z_][a-z0-9_]*\.)?/i, 'EXECUTE FUNCTION public.');
      await client.query(def);
      recreated += 1;
    }
  }
  const rowSecurity = (await client.query(`
    SELECT rel.relname::text t FROM pg_class rel
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace AND ns.nspname = 'public'
     WHERE rel.relkind = 'r' AND rel.relrowsecurity AND rel.relname::text = ANY($1::text[])`,
    [tables])).rows.map((r) => r.t);
  rowSecurity.forEach((t) => rls.push(t));
  return { tables, absent, applied, skippedFks, recreated, omitted, rls };
}

// ---------------------------------------------------------------- seeding rows

// Copy one real `public` row. Every column takes the source value - which is guaranteed to satisfy
// every CHECK, enum and NOT NULL of the identical cloned definition - and the caller overrides only
// what must differ in the clone: the primary key ('FRESH'), a single-column UNIQUE key (a literal
// tag), and an FK column that must point at a clone row (literal) or at nothing ('NULL').
async function copyRow(client, schema, table, sourceWhere, overrides) {
  assertIdent(schema, 'schema'); assertIdent(table, 'table');
  const cols = (await columnsOf(client, table)).filter((c) => c.gen === '' && c.ident === '');
  const items = cols.map((col) => {
    if (col.name in overrides) {
      const v = overrides[col.name];
      if (v === 'NULL') return 'NULL';
      if (v === 'FRESH') return 'gen_random_uuid()';
      if (v === 'NOW') return 'now()';
      return lit(v);
    }
    return `src."${col.name}"`;
  });
  const sql = `INSERT INTO ${schema}.${table} (${cols.map((c) => `"${c.name}"`).join(',')})`
    + ` SELECT ${items.join(', ')} FROM public.${table} src ${sourceWhere || ''} LIMIT 1`
    + ` RETURNING id::text id`;
  const { rows } = await client.query(sql);
  return { table, inserted: rows.length, id: rows[0] && rows[0].id };
}

// The single-column UNIQUE keys of the tables seeded here, measured in fc14_seedfk.log. A copied row
// carries the source's business key, so each of these has to be tagged or the clone rejects the
// insert as a duplicate. Columns the table does not have are simply never named here.
const TAGGED = {
  payments: ['payment_id', 'idempotency_key'],
  payment_sessions: ['order_id'],
  ledger_entries: ['entry_id'],
  journal_transactions: ['transaction_id', 'idempotency_key'],
  payment_refund_authorizations: ['idempotency_key'],
  driver_payouts: ['payout_id', 'idempotency_key'],
  payment_webhooks: ['event_id'],
  jobs: ['job_number'],
  users: ['phone'],
};

// ---------------------------------------------------------------- the executed guard proof

// A DELETE on a clone row. The row exists, so the BEFORE trigger really fires; a refusal is the
// finding, and nothing outside the disposable schema is involved.
const attemptDelete = async (client, schema, table, id) => {
  assertIdent(schema, 'schema'); assertIdent(table, 'table');
  try {
    const { rowCount } = await client.query(`DELETE FROM ${schema}.${table} WHERE id = $1::uuid`, [id]);
    return { table, refused: false, removed: rowCount };
  } catch (e) {
    return { table, refused: true, code: e.code, error: String(e.message).replace(/\s+/g, ' ').slice(0, 150) };
  }
};

// ---------------------------------------------------------------- main

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('F-C1-4 selftest REFUSED: NODE_ENV=production');
  }
  const target = targetGuard.requireLoopbackPgTarget({ label: 'F-C1-4 fixture keep-rule selftest' });
  console.log(`# target: ${target.source} -> ${target.host}:${target.port}/${target.database}`);
  console.log(`# writes: schemas ${PROBE_A} and ${PROBE_B} only; public is read for definitions, `
    + 'trigger text and sample rows');

  // ---- source pins: the rule has to stay where the database cannot put it
  const src = fs.readFileSync(path.join(BACKEND, 'test_fixtures.js'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join('\n');
  check('FKP-01', /const KEPT_FINANCIAL = \['payments', 'payment_sessions'\];/.test(src),
    'KEPT_FINANCIAL exists as one named constant over exactly the two FK-reachable money tables');
  const loopIdx = src.indexOf("for (const { child, column_name } of await childTablesOf('users'))");
  check('FKP-02', loopIdx !== -1 && /if \(KEPT_FINANCIAL\.includes\(child\)\) continue;/.test(src.slice(loopIdx, loopIdx + 400)),
    `the users-child delete loop skips the kept tables by name (loop at index ${loopIdx})`);
  check('FKP-03', /if \(kept\.financial\.length\) \{[\s\S]{0,400}\} else \{\n {6}await del\('users', 'id', users, 'uuid'\);/.test(src),
    'the customer delete sits in the else branch of the keep decision, so a kept payment is never left ownerless');
  check('FKP-04', /if \(kept\.financial\.length\) evidence\.kept = kept;/.test(src)
    && /SELECT count\(\*\)::int n FROM \$\{table\} WHERE customer_id = ANY\(\$1::uuid\[\]\)/.test(src),
    'kept rows are counted before the registry is reset, and reported under kept only when something was kept');

  // The hand-named deletes in cleanup(): every one of them must exist in the clone, or the proof
  // would run against a schema where cleanup silently skips work it does in public.
  const handNamed = Array.from(new Set(Array.from(
    src.matchAll(/del\('([a-z_][a-z0-9_]*)'/g)).map((m) => m[1])
    .concat((src.match(/DELETE FROM backend_sessions/) ? ['backend_sessions'] : []))));

  const boot = new Client({ connectionString: target.connectionString });
  await boot.connect();
  const role = (await boot.query('SELECT current_user::text u')).rows[0].u;
  const baselineSql = `
    SELECT (SELECT count(*) FROM payments)::int p, (SELECT count(*) FROM payment_sessions)::int s,
           (SELECT count(*) FROM ledger_entries)::int l, (SELECT count(*) FROM journal_transactions)::int j,
           (SELECT count(*) FROM journal_lines)::int n, (SELECT count(*) FROM audit_logs)::int a,
           (SELECT count(*) FROM payment_refund_authorizations)::int ra,
           (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM merchants)::int m`;
  const baseline = (await boot.query(baselineSql)).rows[0];
  // How much of the money in this store an append-only table actually protects, measured rather than
  // assumed: payment_refund_authorizations is the one FK that reaches into payments.
  const protectedMoney = (await boot.query(`
    SELECT (SELECT count(*) FROM payments pp WHERE EXISTS (SELECT 1 FROM payment_refund_authorizations pr
              WHERE pr.payment_id = pp.payment_id))::int guarded,
           (SELECT count(*) FROM payments)::int total`)).rows[0];
  console.log(`# role ${role}; public baseline ${JSON.stringify(baseline)}`);
  console.log(`# payments guarded by an append-only refund authorization: ${protectedMoney.guarded}/${protectedMoney.total}`
    + ` - the other ${protectedMoney.total - protectedMoney.guarded} are deletable by any role`);

  const existing = (await boot.query(
    `SELECT nspname::text s FROM pg_namespace WHERE nspname IN ($1, $2)`, [PROBE_A, PROBE_B])).rows;
  if (existing.length) {
    throw new Error(`F-C1-4 selftest REFUSED: probe schema(s) ${existing.map((r) => r.s).join(', ')} already `
      + 'exist - an earlier probe did not clean up. Inspect it, drop it by name, then re-run.');
  }

  // ---- clone A, and the database half of the claim, executed on clone rows
  const cloneA = await cloneSchema(boot, PROBE_A);
  console.log(`  clone ${PROBE_A}: ${cloneA.tables.length} table(s), ${cloneA.applied} constraint(s), `
    + `${cloneA.recreated} DELETE-covering trigger(s) recreated, ${cloneA.omitted.length} INSERT/UPDATE-only `
    + `trigger(s) NOT recreated, ${cloneA.skippedFks.length} FK(s) skipped`);
  console.log(`  clone omissions: fk-skips=[${cloneA.skippedFks.join(', ')}]`);
  console.log(`                     triggers-not-recreated=[${cloneA.omitted.join(', ')}]`);
  console.log(`                     row-security-on-public=[${cloneA.rls.join(', ')}] `
    + `(LIKE does not copy policies; role ${role} is BYPASSRLS-capable, so public reads are unaffected)`);
  console.log(`  requested-but-absent in public: [${cloneA.absent.join(', ')}]`);

  const missing = handNamed.filter((t) => !cloneA.tables.includes(t));
  check('FKP-05', missing.length === 0,
    `every table cleanup() names by hand is present in the clone (${handNamed.length} named: `
    + `${handNamed.join(', ')})${missing.length ? ` - MISSING: ${missing.join(', ')}` : ''}, so a red here `
    + 'means the proof ran on a schema where cleanup cannot do the work it does in public');
  check('FKP-06', cloneA.recreated >= APPEND_ONLY.length,
    `the clone carries ${cloneA.recreated} DELETE-covering trigger(s) recreated from public, so an `
    + 'append-only refusal below is a refusal by the real guard function, not by an absent trigger');

  const stamp = Date.now();
  const tagA = `fka${stamp}`;
  // The anchor user and the job both the money and its ledger point at. The job is deliberately NOT
  // owned by a fixture customer or merchant: in public a journaled fixture job would itself be
  // refused by ledger_entries' NO ACTION key, and this selftest is about the money skip, not that FK.
  const anchorUser = await copyRow(boot, PROBE_A, 'users', '',
    { id: 'FRESH', phone: `+91900000${String(stamp).slice(-6)}`, email: 'NULL' });
  const anchorJob = await copyRow(boot, PROBE_A, 'jobs', '',
    { id: 'FRESH', job_number: `ANCHOR-${stamp}`, customer_id: anchorUser.id, driver_id: 'NULL',
      merchant_id: 'NULL' });
  const anchor = (await boot.query(
    `SELECT (SELECT count(*) FROM ${PROBE_A}.users WHERE id = $1::uuid)::int u,
            (SELECT count(*) FROM ${PROBE_A}.jobs WHERE id = $2::uuid)::int j`,
    [anchorUser.id, anchorJob.id])).rows[0];
  check('FKP-07', anchorUser.inserted === 1 && anchorJob.inserted === 1 && anchor.u === 1 && anchor.j === 1,
    `the anchor user and job the money and its ledger share exist in the clone (${JSON.stringify(anchor)}) - `
    + 'no assertion below runs against an empty schema');

  // Two payments first, because the append-only table below points at one of them by business key:
  // `payment_refund_authorizations.payment_id -> payments(payment_id)` (NO ACTION) is the one foreign
  // key from an audit table INTO the money. `${tagA}_free` has no authorization and must be deletable;
  // `${tagA}_auth` gets one and must not be.
  const freePay = await copyRow(boot, PROBE_A, 'payments', 'WHERE customer_id IS NOT NULL AND job_id IS NOT NULL',
    { id: 'FRESH', payment_id: `${tagA}_free`, idempotency_key: `${tagA}_free_idem`,
      job_id: anchorJob.id, customer_id: anchorUser.id });
  const guardedPay = await copyRow(boot, PROBE_A, 'payments', 'WHERE customer_id IS NOT NULL AND job_id IS NOT NULL',
    { id: 'FRESH', payment_id: `${tagA}_auth`, idempotency_key: `${tagA}_auth_idem`,
      job_id: anchorJob.id, customer_id: anchorUser.id });
  check('FKP-08', freePay.inserted === 1 && guardedPay.inserted === 1,
    `two clone payments exist for the money half of the proof `
    + `(free=${freePay.inserted}, authorized=${guardedPay.inserted})`);

  // Each append-only table: one real public row copied in, re-anchored only where the measured FK map
  // requires it ('JOB' = the anchor job, 'JOURNAL' = the clone journal row just seeded, 'PAY' = the
  // authorized clone payment, 'NULL' = drop the reference), then a DELETE attempted on that row.
  const SEED_SPEC = {
    ledger_entries: { where: 'WHERE job_id IS NOT NULL', over: { job_id: 'JOB' } },
    journal_transactions: { where: 'WHERE job_id IS NOT NULL', over: { job_id: 'JOB' } },
    journal_lines: { where: 'WHERE journal_id IS NOT NULL', over: { journal_id: 'JOURNAL', account_code: 'NULL' } },
    audit_logs: { where: '', over: {} },
    driver_payouts: { where: '', over: { driver_id: 'NULL' } },
    payment_webhooks: { where: '', over: {} },
    payment_refund_authorizations: { where: 'WHERE job_id IS NOT NULL', over: { job_id: 'JOB', payment_id: 'PAY' } },
  };
  const seeds = {};
  const appendResults = [];
  for (const t of APPEND_ONLY) {
    if (!cloneA.tables.includes(t)) { appendResults.push({ table: t, skipped: 'not in clone' }); continue; }
    const spec = SEED_SPEC[t];
    const over = { id: 'FRESH' };
    for (const col of TAGGED[t] || []) over[col] = `${tagA}_${t}_${col}`;
    for (const [col, v] of Object.entries(spec.over)) {
      if (v === 'JOB') over[col] = anchorJob.id;
      else if (v === 'JOURNAL') over[col] = seeds.journal_transactions && seeds.journal_transactions.id;
      else if (v === 'PAY') over[col] = `${tagA}_auth`;
      else over[col] = v;
    }
    const seed = await copyRow(boot, PROBE_A, t, spec.where, over);
    if (!seed.inserted) { appendResults.push({ table: t, skipped: 'no copyable public row' }); continue; }
    seeds[t] = seed;
    appendResults.push(await attemptDelete(boot, PROBE_A, t, seed.id));
  }
  const exercised = appendResults.filter((r) => !r.skipped);
  check('FKP-09', exercised.length >= 3 && exercised.every((r) => r.refused),
    `a DELETE on each append-only clone row is refused for role ${role}: `
    + `${exercised.map((r) => `${r.table}=${r.code || '?'}`).join(', ')}`
    + `${appendResults.filter((r) => r.skipped).length ? ` (not exercised: ${appendResults.filter((r) => r.skipped).map((r) => `${r.table} ${r.skipped}`).join(', ')})` : ''} `
    + '- the rows that document the money are beyond any cleanup');

  const freeDel = await attemptDelete(boot, PROBE_A, 'payments', freePay.id);
  check('FKP-10', freeDel.refused === false && freeDel.removed === 1,
    `the same role CAN delete the payment that has no refund authorization (${JSON.stringify(freeDel)}) - `
    + 'PostgreSQL cannot protect the ledger from this cleanup, so the helper has to decide it');
  check('FKP-11', guardedPay.inserted === 1 && seeds.payment_refund_authorizations !== undefined,
    `the protected case is seeded: the authorized payment and the append-only authorization naming it `
    + `(payment=${guardedPay.inserted}, authorization=${seeds.payment_refund_authorizations ? 1 : 0})`);
  const guardedDel = await attemptDelete(boot, PROBE_A, 'payments', guardedPay.id);
  check('FKP-12', guardedDel.refused === true && guardedDel.code === '23503',
    `and that same role CANNOT delete a payment an append-only row names (${JSON.stringify(guardedDel)}) - `
    + 'the FK protects the refund-authorized subset only, which is why a name-based rule is required');
  // Both probe rows stay exactly as they ended up: the refused authorization and its payment are the
  // finding, and they leave with the disposable schema at teardown.

  // ---- the keep case, through the real helper
  const urlA = withSearchPath(target.connectionString, PROBE_A);
  const fx = await fxModule.openFixtures('fkc14a', { connectionString: urlA });
  const a = fx.client;
  const readBack = (await a.query('SHOW search_path')).rows[0].search_path;
  check('FKP-13', String(fx.target.searchPath).includes(PROBE_A) && readBack.includes(PROBE_A),
    `the handle and this selftest resolve to the same disposable schema (handle read `
    + `"${fx.target.searchPath}", this process read "${readBack}") - one store, no split target`);

  const m = await fx.merchant({ type: 'RESTAURANT', name: 'keep-merchant' });
  const u = await fx.customer({ name: 'keep-customer' });
  const p = await fx.foodProduct(m.id, { name: 'keep-dish' });
  const o = await fx.order({ customerId: u.id, merchantId: m.id, serviceType: 'FOOD', total_amount: 120,
    lines: [{ productId: p.id, name: 'keep-dish', quantity: 1, unit_price_snapshot: 120 }] });
  // Money owned by the fixture customer, documented by ledger/journal rows on the SAME job. That
  // shared job_id is the linkage measured on real data (scratch/review_20261016_c1/fc14_seedshape.log:
  // all 170 `ledger_entries` rows that carry a job share it with a `payments` row; 85 of the 587
  // job-carrying `journal_transactions` do), and it is the shape that makes a money delete a
  // half-reap rather than a cleanup. Every WHERE clause below is measured from the same log, not
  // assumed: `payment_sessions.job_id` is NULL on all 179 rows, so a predicate that required it would
  // seed zero rows and the keep assertions that follow would be vacuous.
  const ownLedger = await copyRow(a, PROBE_A, 'ledger_entries', 'WHERE job_id IS NOT NULL',
    { id: 'FRESH', entry_id: `${tagA}_led`, job_id: anchorJob.id, reference_id: `${tagA}_ref` });
  const ownJournal = await copyRow(a, PROBE_A, 'journal_transactions', 'WHERE job_id IS NOT NULL',
    { id: 'FRESH', transaction_id: `${tagA}_jt`, idempotency_key: `${tagA}_jt_idem`, job_id: anchorJob.id });
  const ownLines = await copyRow(a, PROBE_A, 'journal_lines', 'WHERE journal_id IS NOT NULL',
    { id: 'FRESH', journal_id: ownJournal.id, account_code: 'NULL' });
  const ownPay = await copyRow(a, PROBE_A, 'payments', 'WHERE customer_id IS NOT NULL AND job_id IS NOT NULL',
    { id: 'FRESH', payment_id: `${tagA}_pay`, idempotency_key: `${tagA}_pay_idem`,
      job_id: anchorJob.id, customer_id: u.id });
  const ownSess = await copyRow(a, PROBE_A, 'payment_sessions', 'WHERE customer_id IS NOT NULL',
    { id: 'FRESH', order_id: o.order_number, job_id: 'NULL', customer_id: u.id });
  // Money this handle does NOT own: it hangs off the anchor customer, outside every scope cleanup()
  // works from, so it must survive untouched.
  const otherPay = await copyRow(a, PROBE_A, 'payments', 'WHERE customer_id IS NOT NULL AND job_id IS NOT NULL',
    { id: 'FRESH', payment_id: `${tagA}_other`, idempotency_key: `${tagA}_other_idem`,
      job_id: anchorJob.id, customer_id: anchorUser.id });
  const seeded = [ownLedger, ownJournal, ownLines, ownPay, ownSess, otherPay];
  check('FKP-14', seeded.every((r) => r.inserted === 1),
    `the case is not vacuous - owned payment/session/ledger/journal/lines plus one unowned payment seeded `
    + `(${seeded.map((r) => `${r.table}=${r.inserted}`).join(', ')})`);

  const res = await fx.cleanup();
  const afterA = (await a.query(
    `SELECT (SELECT count(*) FROM payments WHERE customer_id = $1::uuid)::int mine_pay,
            (SELECT count(*) FROM payment_sessions WHERE customer_id = $1::uuid)::int mine_sess,
            (SELECT count(*) FROM payments WHERE payment_id = $2)::int other_pay,
            (SELECT count(*) FROM users WHERE id = $1::uuid)::int customer,
            (SELECT count(*) FROM users WHERE id = $3::uuid)::int anchor_user,
            (SELECT count(*) FROM jobs WHERE id = $4::uuid)::int anchor_job,
            (SELECT count(*) FROM merchants WHERE id = $5::uuid)::int merchant,
            (SELECT count(*) FROM orders WHERE merchant_id = $5::uuid OR customer_id = $1::uuid)::int orders,
            (SELECT count(*) FROM order_lines WHERE merchant_id = $5::uuid)::int lines,
            (SELECT count(*) FROM restaurant_kds_tickets WHERE merchant_id = $5::uuid)::int kds,
            (SELECT count(*) FROM ledger_entries WHERE entry_id = $6)::int ledger_mine,
            (SELECT count(*) FROM journal_transactions WHERE transaction_id = $7)::int journal_mine,
            (SELECT count(*) FROM journal_lines WHERE id = $8::uuid)::int lines_mine,
            (SELECT count(*) FROM payments WHERE payment_id = $9)::int own_pay_id`,
    [u.id, `${tagA}_other`, anchorUser.id, anchorJob.id, m.id, `${tagA}_led`, `${tagA}_jt`,
      ownLines.id, `${tagA}_pay`])).rows[0];

  check('FKP-15', Array.isArray(res.blocked) && res.blocked.length === 0,
    `cleanup reported no refused delete (blocked=${JSON.stringify(res.blocked)}) - the keep is a decision, `
    + 'not a NO ACTION violation a suite would read as a cleanup bug');
  check('FKP-16', afterA.mine_pay === 1 && afterA.mine_sess === 1 && afterA.own_pay_id === 1,
    `the fixture customer's money survived cleanup (payments=${afterA.mine_pay}, `
    + `payment_sessions=${afterA.mine_sess})`);
  check('FKP-17', !!res.kept && Array.isArray(res.kept.financial)
    && res.kept.financial.some((f) => f.table === 'payments' && f.rows >= 1)
    && res.kept.financial.some((f) => f.table === 'payment_sessions' && f.rows >= 1)
    && typeof res.kept.reason === 'string' && res.kept.reason.length > 40 && res.kept.users === 1,
    `cleanup reported the keep with its reason: `
    + `${JSON.stringify(res.kept && { financial: res.kept.financial, users: res.kept.users })}`);
  check('FKP-18', afterA.customer === 1,
    `the owning customer is kept with its money (users row present=${afterA.customer}) - no kept payment `
    + 'without an owner');
  check('FKP-19', afterA.other_pay === 1 && afterA.anchor_user === 1 && afterA.anchor_job === 1,
    `rows this handle does not own were untouched (unowned payment=${afterA.other_pay}, `
    + `anchor user=${afterA.anchor_user}, anchor job=${afterA.anchor_job}) - the scope is ownership, `
    + 'not "looks like test data"');
  check('FKP-20', afterA.merchant === 0 && afterA.orders === 0 && afterA.lines === 0 && afterA.kds === 0,
    `everything else this handle owned went: merchant=${afterA.merchant}, orders=${afterA.orders}, `
    + `order_lines=${afterA.lines}, kds=${afterA.kds} - the rule keeps two tables, not the whole cleanup`);
  check('FKP-21', afterA.ledger_mine === 1 && afterA.journal_mine === 1 && afterA.lines_mine === 1,
    `the ledger, journal and journal-line rows documenting the kept money are still beside it `
    + `(ledger=${afterA.ledger_mine}, journal=${afterA.journal_mine}, lines=${afterA.lines_mine}) - `
    + 'money and audit left the run balanced');

  // ---- the pre-fix shape, replicated and rolled back: without the skip the money is reaped.
  // Statement-by-statement, because a parameterised simple query cannot carry a transaction script.
  let preError = null;
  try {
    await a.query('BEGIN');
    await a.query('DELETE FROM payments WHERE customer_id = $1::uuid', [u.id]);
    await a.query('DELETE FROM payment_sessions WHERE customer_id = $1::uuid', [u.id]);
    await a.query('DELETE FROM users WHERE id = $1::uuid', [u.id]);
    await a.query('ROLLBACK');
  } catch (e) { preError = String(e.message).replace(/\s+/g, ' ').slice(0, 160); }
  const afterPre = (await a.query(
    `SELECT (SELECT count(*) FROM payments WHERE customer_id = $1::uuid)::int mine_pay,
            (SELECT count(*) FROM payment_sessions WHERE customer_id = $1::uuid)::int mine_sess,
            (SELECT count(*) FROM users WHERE id = $1::uuid)::int customer,
            (SELECT count(*) FROM ledger_entries WHERE entry_id = $2)::int ledger`,
    [u.id, `${tagA}_led`])).rows[0];
  check('FKP-22', preError === null,
    `the pre-fix delete order (users' children including payments, then the customer) ran as a legal `
    + `script in a schema carrying the real DELETE guards${preError ? ` - ERROR ${preError}` : ''} - `
    + 'the skip, not the engine, is what stops it');
  check('FKP-23', afterPre.mine_pay === 1 && afterPre.mine_sess === 1 && afterPre.customer === 1
    && afterPre.ledger === 1,
    `after ROLLBACK the money, the session, the customer and its ledger row are all back `
    + `(${JSON.stringify(afterPre)}) - the half-reaped state was demonstrated, not left behind`);

  // ---- case B: a fixture customer with NO money is deleted exactly as before the rule existed
  const cloneB = await cloneSchema(boot, PROBE_B);
  const fxb = await fxModule.openFixtures('fkc14b', { connectionString: withSearchPath(target.connectionString, PROBE_B) });
  const mb = await fxb.merchant({ type: 'RESTAURANT', name: 'plain-merchant' });
  const ub = await fxb.customer({ name: 'plain-customer' });
  const resB = await fxb.cleanup();
  const countsB = (await boot.query(
    `SELECT (SELECT count(*) FROM ${PROBE_B}.users)::int users,
            (SELECT count(*) FROM ${PROBE_B}.merchants)::int merchants,
            (SELECT count(*) FROM ${PROBE_B}.payments)::int payments,
            (SELECT count(*) FROM ${PROBE_B}.payment_sessions)::int sessions,
            (SELECT count(*) FROM ${PROBE_B}.orders)::int orders`)).rows[0];
  check('FKP-24', resB.blocked.length === 0 && resB.kept === undefined && resB.users === 1
    && countsB.users === 0 && countsB.merchants === 0 && countsB.orders === 0
    && countsB.payments === 0 && countsB.sessions === 0,
    `the no-money path is unchanged: kept=${JSON.stringify(resB.kept)}, removed.users=${resB.users}, `
    + `left in schema users=${countsB.users} merchants=${countsB.merchants} orders=${countsB.orders} `
    + `payments=${countsB.payments} sessions=${countsB.sessions} - the rule did not turn the ordinary `
    + 'case into residue');

  await fxb.close().catch(() => {});
  await a.end().catch(() => {});
  await boot.query(`DROP SCHEMA IF EXISTS ${PROBE_A} CASCADE`);
  await boot.query(`DROP SCHEMA IF EXISTS ${PROBE_B} CASCADE`);
  const still = (await boot.query(
    `SELECT nspname::text s FROM pg_namespace WHERE nspname IN ($1, $2)`, [PROBE_A, PROBE_B])).rows;
  check('FKP-25', still.length === 0,
    `teardown: DROP SCHEMA ${PROBE_A}, ${PROBE_B} CASCADE confirmed absent (still present: `
    + `${JSON.stringify(still.map((r) => r.s))})`);

  const np = (await boot.query(baselineSql)).rows[0];
  await boot.end();
  check('FKP-26', Object.keys(np).every((k) => Number(np[k]) === Number(baseline[k])),
    `public is unchanged end to end (${JSON.stringify(baseline)} -> ${JSON.stringify(np)}) - this `
    + 'selftest read definitions, trigger text and sample rows, and wrote only into the disposable schemas');

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? '❌' : '✅'} FKP_SUMMARY passed=${results.length - failed} failed=${failed} skipped=0 `
    + `(clone A tables=${cloneA.tables.length} triggers=${cloneA.recreated}, `
    + `clone B tables=${cloneB.tables.length}, role=${role})`);
  console.log(`${results.length - failed}/${results.length} passed, ${failed} failed`);
  for (const r of results.filter((x) => !x.ok)) console.log(`   FAILED ${r.id}: ${r.detail}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(async (e) => {
  console.error(`F-C1-4 SELFTEST FAILED ${e.code || ''} ${e.message}`);
  console.error(String(e.stack || '').split('\n').slice(1, 5).join('\n'));
  // A red run must not leave a probe schema behind. The next run refuses one that already exists, so
  // an abandoned clone turns a single failure into a blocked suite; and the clone is disposable by
  // definition, so dropping it here is teardown, not cleanup of anyone else's data.
  try {
    const t = targetGuard.requireLoopbackPgTarget({ label: 'F-C1-4 selftest failure teardown' });
    const c = new Client({ connectionString: t.connectionString });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS ${PROBE_A} CASCADE`);
    await c.query(`DROP SCHEMA IF EXISTS ${PROBE_B} CASCADE`);
    await c.end();
    console.error(`failure teardown: ${PROBE_A} and ${PROBE_B} dropped if they existed`);
  } catch (teardownError) {
    console.error(`failure teardown FAILED: ${teardownError.message} - drop the probe schemas by hand`);
  }
  process.exitCode = 1;
});
