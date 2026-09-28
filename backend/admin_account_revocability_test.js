/*
 * PHASE 41 regression — a provisioned administrator must be revocable.
 *
 * Root cause proven in a clean boot: `admin_accounts` had 1059 rows while PostgREST caps a single
 * read at 1000, so `setAdminAccountStatus`'s whole-table scan never saw the row it was asked to
 * change and answered 409 ADMIN_NOT_ENROLLED - while the same account could still sign in, because
 * authentication uses an exact-match read that is not subject to the cap. The guard was right;
 * the data behind it was truncated.
 *
 * This test pins the whole lifecycle: provision -> list -> disable -> rejected -> re-enable ->
 * accepted -> and that a genuinely unknown identifier still gets the fail-closed refusal.
 * Local/test only; refuses any non-loopback target.
 */
const crypto = require('crypto');
const { Client } = require('pg');
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('REFUSED: non-loopback target'); process.exit(1);
}

const SUF = crypto.randomBytes(4).toString('hex');
const USERNAME = `rev_${SUF}`;
const PASSWORD = 'RevocableProbe123!';
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 170)}` : ''));
}
const api = async (method, path, body, token) => {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': `Bearer ${token}` } : {}),
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  const login = await api('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const tok = login.data.token;
  check('REV-00', 'a SUPER_ADMIN session exists for the harness', login.status === 200 && !!tok, { status: login.status });
  if (!tok) { console.log('cannot continue without an admin token'); process.exit(1); }

  const created = await api('POST', '/api/admin/accounts', {
    name: 'Revocable probe', username: USERNAME, email: `${USERNAME}@nabin.in`,
    phone: `+91 977${SUF}`, role: 'OPERATIONS', department: 'Revocation', password: PASSWORD
  }, tok);
  const acct = created.data.account || created.data.admin || created.data;
  const id = acct && (acct.id || acct.uuid);
  check('REV-01', 'provisioning a new administrator succeeds', created.status === 200 && !!id,
    { status: created.status, code: created.data.code || '' });
  if (!id) process.exit(1);

  const durable = await one('SELECT id::text, username, role, is_active::text a FROM admin_accounts WHERE id=$1::uuid', [id]);
  check('REV-02', 'the row is durable in PostgreSQL and enabled', !!durable && durable.a === 'true', durable);

  const listed = await api('GET', '/api/admin/accounts', null, tok);
  const found = (listed.data.accounts || []).filter(a => String(a.username).startsWith('rev_'));
  check('REV-03', 'the directory lists the account it just provisioned',
    found.some(a => String(a.username) === USERNAME),
    { listed: (listed.data.accounts || []).length, rev_prefixed: found.length });

  // disable by id - the operation that was refusing with ADMIN_NOT_ENROLLED
  const offById = await api('POST', `/api/admin/accounts/${encodeURIComponent(String(id))}/status`,
    { isActive: false, reason: 'phase 41 revocation regression' }, tok);
  check('REV-04', 'disabling by account id succeeds', offById.status === 200
    && offById.data.account && String(offById.data.account.status).toUpperCase() === 'INACTIVE',
    { status: offById.status, code: offById.data.code || '', accountStatus: offById.data.account && offById.data.account.status });
  const afterOff = await one('SELECT is_active::text a FROM admin_accounts WHERE id=$1::uuid', [id]);
  check('REV-05', 'the durable row really says is_active = false', afterOff.a === 'false', afterOff);

  const signInDisabled = await api('POST', '/api/admin/login', { username: USERNAME, password: PASSWORD });
  check('REV-06', 'a disabled administrator cannot sign in', signInDisabled.status === 401,
    { status: signInDisabled.status });
  if (signInDisabled.data.token) {
    const me = await api('GET', '/api/admin/me', null, signInDisabled.data.token);
    check('REV-07', 'and no already-issued bearer of it survives either', me.status === 401, { me: me.status });
  } else check('REV-07', 'no bearer was issued to disable, so nothing to revoke', true);

  // re-enable, then disable by username (the other supported identifier shape)
  const on = await api('POST', `/api/admin/accounts/${encodeURIComponent(USERNAME)}/status`,
    { isActive: true, reason: 'phase 41 re-enable' }, tok);
  check('REV-08', 're-enabling by username works and restores sign-in',
    on.status === 200 && (await api('POST', '/api/admin/login', { username: USERNAME, password: PASSWORD })).status === 200,
    { enable: on.status, code: on.data.code || '' });
  const offByName = await api('POST', `/api/admin/accounts/${encodeURIComponent(USERNAME)}/status`,
    { isActive: false, reason: 'phase 41 disable by username' }, tok);
  check('REV-09', 'disabling by username works too', offByName.status === 200,
    { status: offByName.status, code: offByName.data.code || '' });

  // the guard must still fire for an identifier that genuinely does not exist
  const ghost = await api('POST', '/api/admin/accounts/rev_ghost_zz9/status', { isActive: false, reason: 'guard probe' }, tok);
  check('REV-10', 'a genuinely unknown identifier still gets the fail-closed refusal',
    ghost.status === 409 && ghost.data.code === 'ADMIN_NOT_ENROLLED', { status: ghost.status, code: ghost.data.code });

  // an existing seeded administrator must be unaffected
  const seeded = await api('GET', '/api/admin/me', null, tok);
  check('REV-11', 'the platform SUPER_ADMIN still authenticates normally', seeded.status === 200,
    { status: seeded.status });

  // teardown: leave the probe disabled and report rowCount + verified absence of enablement
  const fin = await one('SELECT is_active::text a FROM admin_accounts WHERE id=$1::uuid', [id]);
  console.log(`  teardown: probe ${USERNAME} (${id}) durable is_active=${fin.a}`
    + (fin.a === 'false' ? ' -> left disabled (verified)' : ' -> NOT DISABLED'));
  const del = await c.query('DELETE FROM admin_accounts WHERE id=$1::uuid AND is_active = false', [id]);
  const gone = await one('SELECT count(*) n FROM admin_accounts WHERE id=$1::uuid', [id]);
  console.log(`  DELETE admin_accounts id=${id} rowCount=${del.rowCount}; post-delete count=${gone.n}`
    + (del.rowCount === 1 && Number(gone.n) === 0 ? ' -> verified removed' : ' -> retained (disabled) or FK-blocked'));
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== REVOCATION REGRESSION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
