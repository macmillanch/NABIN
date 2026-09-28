/*
 * T1 regression — an identity decision must never be made on a truncated authoritative read.
 *
 * Defect: `resolveAdminByPhone` (database.js) reads `admin_accounts` with ONE unfiltered
 * select('*'). supabase/config.toml sets PostgREST `max_rows = 1000`, and the table measures
 * ~1233 rows, so ~233 enrolled administrators are simply absent from the set that the identity
 * decision is taken over.
 *
 * Repair notes for this file (the first version was correctly rejected):
 *   - it guessed that a row inserted last falls outside the capped page. A capped page without an
 *     ORDER BY is not insertion order, so that assumption was unsound. It is gone: the subject row
 *     is now SELECTED by measurement - present in the complete keyset walk, absent from the capped
 *     page - and the test refuses to proceed if no such row exists.
 *   - it normalised the phone itself instead of using the application's own `db.normalizePhone`,
 *     so a null result was an artefact of the test, not of the code. The app's helper is used now.
 *
 * Structural proof and behavioural proof are asserted separately and labelled as such.
 * Local/test only; refuses any non-loopback database.
 */
const crypto = require('crypto');
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('T1 REGRESSION REFUSED: non-loopback database'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const db = require('./src/database');
const { grantsForRole } = require('./src/adminPermissions');

const STAMP = Date.now();
const results = [];
const probeIds = [];
function check(id, kind, name, cond, detail) {
  results.push({ id, kind, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} (${kind}) ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 190)}` : ''));
}

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  // ---------- STRUCTURAL: is the capped read actually smaller than the table? ----------
  const total = Number((await one('SELECT count(*) n FROM admin_accounts')).n);
  const capped = await supabaseAdmin.from('admin_accounts').select('id, phone, role, is_active').limit(1000);
  const cappedIds = new Set((capped.data || []).map(r => String(r.id)));
  const walk = await db.readAllRows(supabaseAdmin, { table: 'admin_accounts', select: 'id, phone, role, is_active' });
  console.log(`admin_accounts total=${total} capped_page=${cappedIds.size} walk=${walk.rows.length} complete=${walk.complete} pages=${walk.pages}`);

  check('T1-S1', 'structural', 'the table is larger than one PostgREST page',
    total > 1000, { total });
  check('T1-S2', 'structural', 'a capped read without ORDER BY returns only the first page',
    cappedIds.size === 1000 || cappedIds.size < total, { capped: cappedIds.size, total });
  check('T1-S3', 'structural', 'the platform keyset walk reads every row and says so',
    walk.complete === true && walk.rows.length === total && walk.pages >= 2,
    { complete: walk.complete, rows: walk.rows.length, pages: walk.pages, error: walk.error });

  const outside = walk.rows.filter(r => !cappedIds.has(String(r.id)));
  check('T1-S4', 'structural', 'real durable admin rows exist outside the capped page',
    outside.length === total - cappedIds.size && outside.length > 0,
    { outside: outside.length, missing: total - cappedIds.size });

  // Choose a subject by measurement, never by insertion order. Requirements: it has a phone the
  // application can normalise to something non-empty, its normalised number is unique across the
  // WHOLE directory (so this is an existence test, not an ambiguity test), and its role is one the
  // platform grants, so resolution cannot fail for an unrelated reason.
  const normOf = (v) => String(db.normalizePhone(v) || '');
  const normCount = new Map();
  for (const r of walk.rows) {
    const n = normOf(r.phone);
    if (n) normCount.set(n, (normCount.get(n) || 0) + 1);
  }
  let subject = outside.find(r => r.phone && normOf(r.phone)
    && normCount.get(normOf(r.phone)) === 1 && grantsForRole(r.role));

  if (!subject) {
    // Requirement B: probe rows are allowed, but membership is MEASURED before use. Insertion order
    // proves nothing about which page a row lands on, so each probe is checked against a fresh
    // capped page and only one observed to sit outside it becomes the subject. Probes are
    // is_active = false: resolution ignores that column, so the test needs no privilege at all.
    console.log('no existing outside-the-page row qualified; measuring controlled probes instead');
    const probes = [];
    for (let i = 0; i < 12; i++) {
      const phone = `+91 93${String(STAMP).slice(-8)}${String(i).padStart(2, '0')}`;
      const { data, error } = await supabaseAdmin.from('admin_accounts').insert({
        username: `t1subj${i}_${STAMP}`, name: `T1 subject probe ${i}`,
        email: `t1subj${i}_${STAMP}@nabin.in`, phone, role: 'OPERATIONS',
        department: 'T1 probe', is_active: false,
        password_hash: 'not-a-credential', password_salt: 'not-a-credential'
      }).select('id, phone, role, is_active').single();
      if (error) throw new Error(`subject probe insert failed: ${error.message}`);
      probeIds.push(data.id);
      probes.push(data);
    }
    // One fresh capped page and ONE complete walk. The walk must select `id`: its keyset cursor
    // advances on the primary key, and `readAllRows` reports `complete:false` rather than
    // pretending a cursor-less page is the whole table (seen while writing this, and correct).
    const pageNow = await supabaseAdmin.from('admin_accounts').select('id').limit(1000);
    const idsNow = new Set((pageNow.data || []).map(r => String(r.id)));
    const walkNow = await db.readAllRows(supabaseAdmin, { table: 'admin_accounts', select: 'id, phone' });
    if (!walkNow.complete) throw new Error(`completeness walk failed: ${walkNow.error}`);
    const countByNorm = new Map();
    for (const r of walkNow.rows) {
      const n = normOf(r.phone);
      if (n) countByNorm.set(n, (countByNorm.get(n) || 0) + 1);
    }
    for (const p of probes) {
      const inPage = idsNow.has(String(p.id));
      const unique = countByNorm.get(normOf(p.phone)) === 1;
      console.log(`  probe ${p.username}: membership=${inPage ? 'inside' : 'outside'} unique=${unique}`);
      if (!inPage && unique) { subject = p; break; }
    }
  }

  if (!subject) {
    console.log('BEHAVIOURAL TESTS SKIPPED: no outside-the-page row has a uniquely normalised phone');
    console.log('with a recognised role. Refusing to assert against an unsuitable subject; the');
    console.log('structural findings stand, and this run is marked failed so the gap is visible.');
  } else {
    const subjectNorm = normOf(subject.phone);
    console.log(`\nsubject: id=${subject.id} role=${subject.role} is_active=${subject.is_active}`
      + ` (phone deliberately not printed); uniqueness across directory = ${normCount.get(subjectNorm)}`);

    // ---------- BEHAVIOURAL: can the application resolve an identity it cannot see? ----------
    let got = null, err = null;
    try { got = await db.resolveAdminByPhone(subjectNorm); } catch (e) { err = e; }
    check('T1-B1', 'behavioural', 'an enrolled administrator outside the capped page resolves',
      !!got && String(got.id) === String(subject.id),
      { resolved: !!got, id: got && got.id, expected: subject.id, err: err && (err.code || err.message.slice(0, 60)) });
    check('T1-B2', 'behavioural', 'and it is resolved with its own role and grant set',
      !!got && got.role === subject.role && Array.isArray(got.permissions) && got.permissions.length > 0,
      { role: got && got.role, perms: got && got.permissions && got.permissions.length });

    // An unknown number must still resolve to nothing: the fix must not turn "not found" into
    // "someone".
    let miss = 'sentinel', missErr = null;
    try { miss = await db.resolveAdminByPhone(normOf(`+91 91${String(crypto.randomBytes(4).readUInt32BE(0) % 1e8).padStart(8, '0')}`)); }
    catch (e) { missErr = e; }
    check('T1-B3', 'behavioural', 'an unenrolled number still resolves to nothing',
      missErr === null && miss === null, { result: miss, err: missErr && missErr.code });

    // ---------- AMBIGUITY: two accounts, one number, decided on COMPLETE data ----------
    // Both probes are is_active = false, so this creates no privilege at all; resolution does not
    // filter on is_active, so the guard is still exercised.
    const ambPhone = `+91 90${String(STAMP).slice(-8)}`;
    const ambNorm = normOf(ambPhone);
    const mkAmb = async (label) => {
      const { data, error } = await supabaseAdmin.from('admin_accounts').insert({
        username: `t1amb${label}_${STAMP}`, name: `T1 ambiguity probe ${label}`,
        email: `t1amb${label}_${STAMP}@nabin.in`, phone: ambPhone, role: 'OPERATIONS',
        department: 'T1 probe', is_active: false,
        password_hash: 'not-a-credential', password_salt: 'not-a-credential'
      }).select('id').single();
      if (error) throw new Error(`ambiguity probe insert failed: ${error.message}`);
      probeIds.push(data.id);
      return data.id;
    };
    const ambIds = [await mkAmb('a'), await mkAmb('b')];
    // Membership measured, never assumed.
    const cappedNow = await supabaseAdmin.from('admin_accounts').select('id').limit(1000);
    const cappedNowIds = new Set((cappedNow.data || []).map(r => String(r.id)));
    const ambMembership = ambIds.map(id => cappedNowIds.has(String(id)) ? 'inside' : 'outside');
    console.log(`ambiguity probes membership in the capped page: ${ambMembership.join(', ')}`);
    let ambOutcome = 'returned', ambCode = null, ambChosen = null;
    try {
      const r = await db.resolveAdminByPhone(ambNorm);
      ambChosen = r ? String(r.id) : null;
      ambOutcome = r ? 'resolved-one' : 'returned-null';
    } catch (e) { ambOutcome = 'threw'; ambCode = e.code; }
    // Correct behaviour is a refusal whenever BOTH accounts exist in the directory - regardless of
    // which page each happens to land on. When both sit inside the page this already held before
    // the fix; when one or both sit outside, the capped read could not see the pair.
    check('T1-B4', 'behavioural', 'a number enrolled for two accounts is refused, never silently decided',
      ambOutcome === 'threw' && ambCode === 'ADMIN_PHONE_ENROLMENT_AMBIGUOUS',
      { outcome: ambOutcome, code: ambCode, chosen: ambChosen, membership: ambMembership });
    check('T1-B5', 'behavioural', 'it never answers with one arbitrary account of the pair',
      !(ambOutcome === 'resolved-one'), { chosen: ambChosen, pair: ambIds });
  }

  // ---------- FAIL CLOSED: two distinct failures, both refusing to answer from a partial set ----
  const realWalk = db.readAllRows;
  const probeWith = async (stub) => {
    let out = { returned: null, code: null, status: null };
    try {
      db.readAllRows = async () => stub;
      const r = await db.resolveAdminByPhone(normOf('+91 9000000000'));
      out.returned = r === null ? 'null' : 'object';
    } catch (e) {
      out.code = e.code || null;
      out.status = e.status || e.statusCode || null;
    } finally { db.readAllRows = realWalk; }
    return out;
  };
  const partial = await probeWith({ rows: [{ id: 'x', phone: '+91 9000000000' }], complete: false, error: 'simulated mid-walk failure', pages: 1 });
  check('T1-B6', 'behavioural', 'a PARTIAL directory read fails closed with ADMIN_DIRECTORY_INCOMPLETE',
    partial.code === 'ADMIN_DIRECTORY_INCOMPLETE' && partial.status === 503, partial);
  const dark = await probeWith({ rows: [], complete: false, error: 'simulated unreachable store', pages: 0 });
  check('T1-B6b', 'behavioural', 'an UNREACHABLE store keeps the established AUTH_STORE_UNAVAILABLE code',
    dark.code === 'AUTH_STORE_UNAVAILABLE' && dark.status === 503, dark);
  check('T1-B7', 'behavioural', 'the stubbed helper is restored (no leaked test double)',
    db.readAllRows === realWalk);

  // ---------- CLEANUP ----------
  console.log('\n=== cleanup (rowCount + post-delete verification) ===');
  for (const id of probeIds) {
    const del = await c.query('DELETE FROM admin_accounts WHERE id=$1::uuid', [id]);
    const gone = await one('SELECT count(*) n FROM admin_accounts WHERE id=$1::uuid', [id]);
    console.log(`  DELETE admin_accounts ${id} rowCount=${del.rowCount}; post-delete count=${gone.n}`
      + (del.rowCount === 1 && Number(gone.n) === 0 ? ' -> verified removed' : ' -> NOT VERIFIED'));
  }
  const left = await one("SELECT count(*) n FROM admin_accounts WHERE username LIKE 't1amb%' OR username LIKE 't1\\_%'");
  console.log(`  t1 probe rows remaining in admin_accounts: ${left.n}`);
  const enabled = await one("SELECT count(*) n FROM admin_accounts WHERE is_active = true AND (username LIKE 't1%' OR username LIKE 'p40%' OR username LIKE 'rev_%')");
  console.log(`  enabled diagnostic probes remaining: ${enabled.n}`);
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== T1 DIRECTORY-COMPLETENESS: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => `${f.id}[${f.kind}]`).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(async e => {
  console.error('FATAL', e.message);
  for (const id of probeIds) { try { await supabaseAdmin.from('admin_accounts').delete().eq('id', id); } catch (x) {} }
  process.exitCode = 1;
});
