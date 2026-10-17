/*
 * Task 3 regression - merchant authentication must fail closed for an unregistered phone.
 *
 * The defect: in `verifyAuthOtp`, the MERCHANT branch resolves the session entity by
 * normalized phone, and when nothing matches it throws in production but silently assigns
 * `entity = this.restaurants[0]` everywhere else (backend/src/database.js:6249). So in any
 * dev/staging/test deployment, ANY unregistered number that completes an OTP challenge
 * becomes a specific real merchant - its dashboard, orders, inventory and entitlements -
 * with no signal at all. The ADMIN branch beside it already shows the intended convention:
 * the `adminUsers[0]` stand-in was replaced by a typed refusal (`ADMIN_PHONE_NOT_ENROLLED`).
 *
 * This suite asserts the same fail-closed contract for merchants, in both the HTTP auth
 * boundary and the service function directly, and pins that legitimate registered merchants
 * keep authenticating unchanged.
 *
 * Fixtures are created by this suite through the shared isolated-fixture helper: one registered
 * merchant per service context, each with a phone proven unused before the insert, plus a
 * duplicate-phone pair for the observation below. Nothing is forged, no session row is inserted,
 * and no shared seeded row is asserted about or overwritten - that dependency is what made this
 * link fail whenever another suite restyled merchant 00000000-…-0201. Every row created here is
 * deleted again by the same handle before the suite exits.
 *
 * Local/test only; refuses any non-loopback target.
 */
const { Client } = require('pg');
const { spawnSync } = require('child_process');
const path = require('path');
const { openFixtures } = require('./test_fixtures');
const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: this suite writes and asserts through this handle, so its store must be a target
// something DECLARED (shell, then backend/.env) and loopback - never an address typed into
// this file, which is what let a run write one store and assert against another (#283).
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'merchant_auth_failclosed_test' });
const PG = PG_TARGET.connectionString;
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('MAFC REFUSED: non-loopback target'); process.exit(1);
}
const OTP = process.env.NABIN_TEST_OTP || '7729';
// one registered merchant per service context the auth boundary has to answer for
const FIXTURE_PLAN = [
  { key: 'RESTAURANT_HYBRID', type: 'HYBRID_BOTH', name: 'hybrid' },
  { key: 'RESTAURANT', type: 'RESTAURANT', name: 'restaurant' },
  { key: 'GROCERY', type: 'GROCERY', name: 'grocery' },
];
// never registered for any merchant row; verified below against the durable table
const UNREGISTERED = '9840000001';
const norm = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
const results = [];
let fxHandle = null;
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 210)}` : ''));
}
const api = async (method, urlPath, body, token) => {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};
const otpLogin = (phone) => api('POST', '/api/auth/verify-otp', { phone, otp: OTP, role: 'MERCHANT', purpose: 'LOGIN' });

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const fx = await openFixtures('mafc', { connectionString: PG });
  fxHandle = fx;
  const FIXTURES = [];
  for (const plan of FIXTURE_PLAN) {
    const m = await fx.merchant({ type: plan.type, name: plan.name });
    FIXTURES.push({ key: plan.key, phone: m.phone, uuid: m.id, type: plan.type });
  }
  // two merchants on one number, created here so the observation below has a real pair
  const DUPLICATE = (await fx.freePhone('merchants')).slice(-10);
  await fx.merchant({ type: 'RESTAURANT', name: 'duplicate-a', phone: DUPLICATE });
  await fx.merchant({ type: 'RESTAURANT', name: 'duplicate-b', phone: DUPLICATE });
  // the shared seeded row this suite used to depend on: read once, never written
  const SEED_ROW = '00000000-0000-0000-0000-000000000201';
  const seedTypeAt = async () => ((await one(
    'SELECT merchant_type t FROM merchants WHERE id = $1::uuid', [SEED_ROW])) || {}).t ?? '(no row)';
  const seedTypeStart = await seedTypeAt();
  const merchantIds = (await c.query('SELECT id::text id, phone, merchant_type FROM merchants')).rows;
  const byPhone = (p) => merchantIds.filter(m => norm(m.phone) === norm(p));
  const startMerchants = Number((await one('SELECT count(*)::text n FROM merchants')).n);
  const startJournal = await one(`SELECT (SELECT count(*) FROM journal_transactions)::text jt,
      (SELECT count(*) FROM journal_lines)::text jl, (SELECT count(*) FROM driver_payouts)::text po`);

  // ---- 0. this suite's own fixtures are what they claim to be ----
  for (const f of FIXTURES) {
    const rows = byPhone(f.phone);
    check('MAFC-00.' + f.key, `${f.key} fixture ${f.phone} is one registered merchant of that type`,
      rows.length === 1 && rows[0].merchant_type === f.type && String(rows[0].id) === String(f.uuid),
      { found: rows.length, type: rows[0] && rows[0].merchant_type });
  }
  check('MAFC-00.UNREG', `${UNREGISTERED} is genuinely unregistered for every merchant`,
    byPhone(UNREGISTERED).length === 0, { matches: byPhone(UNREGISTERED).length });

  // ---- A/B/C: legitimate merchants keep authenticating, with their own durable identity ----
  for (const f of FIXTURES) {
    const r = await otpLogin(f.phone);
    const tok = r.data && r.data.token;
    check(`MAFC-A.${f.key}`, `registered ${f.key} merchant authenticates`, r.status === 200 && !!tok,
      { status: r.status, code: r.data.code });
    if (!tok) continue;
    const me = await api('GET', '/api/auth/me', undefined, tok);
    const meId = String((me.data && me.data.user && (me.data.user.uuid || me.data.user.id)) || '');
    check(`MAFC-B.${f.key}`, `${f.key} session reports role MERCHANT and its OWN merchant uuid`,
      me.status === 200 && String(me.data.role || '').toUpperCase() === 'MERCHANT'
        && meId === String(f.uuid),
      { role: me.data && me.data.role, meId: meId.slice(0, 12), expected: String(f.uuid).slice(0, 12) });
  }

  // ---- D/E: the unregistered phone must NOT be given anyone's identity ----
  const bad = await otpLogin(UNREGISTERED);
  check('MAFC-D', 'an unregistered merchant phone is refused at the auth boundary (no token issued)',
    bad.status >= 400 && !bad.data.token, { status: bad.status, code: bad.data.code, keys: Object.keys(bad.data) });
  const badUuid = String((bad.data.user && (bad.data.user.uuid || bad.data.user.id)) || '');
  const legitUuids = new Set(FIXTURES.map(f => String(f.uuid)));
  // No token, and no identity of any kind: an empty uuid IS the wanted outcome. The first
  // draft of this check also demanded a non-empty uuid, which contradicts "no identity" and so
  // failed for the wrong reason even when the fix was correct.
  check('MAFC-E', 'the refused attempt hands out NO merchant identity - not restaurants[0], not any store',
    !bad.data.token && !badUuid && !legitUuids.has(badUuid),
    { uuid_leaked: badUuid || '(none)', status: bad.status, code: bad.data.code });
  if (bad.data.token) {
    const meBad = await api('GET', '/api/auth/me', undefined, bad.data.token);
    check('MAFC-E2', 'a refused phone cannot reach /api/auth/me as MERCHANT', false,
      { role: meBad.data && meBad.data.role, id: String(meBad.data?.user?.id).slice(0, 12) });
  } else {
    const meBad = await api('GET', '/api/auth/me', undefined, 'unregistered-no-session');
    check('MAFC-E2', 'with no session issued, /api/auth/me cannot become MERCHANT',
      meBad.status === 401 && String(meBad.data?.role || '').toUpperCase() !== 'MERCHANT',
      { status: meBad.status });
  }

  // ---- F: no protected merchant surface is reachable for the refused phone ----
  const svc = require('./src/database');
  let directErr = null, directOk = null;
  try { directOk = await svc.verifyAuthOtp({ phone: UNREGISTERED, otp: OTP, role: 'MERCHANT', purpose: 'LOGIN' }); }
  catch (e) { directErr = e; }
  check('MAFC-F', 'verifyAuthOtp itself refuses, with a typed authentication error',
    !directOk && !!directErr && typeof directErr.code === 'string' && /MERCHANT/.test(directErr.code),
    { code: directErr && directErr.code, status: directErr && directErr.status, got: directOk ? 'TOKEN_ISSUED' : 'threw' });

  // no merchant tenant/entitlement access with whatever was (not) issued
  const probeTok = bad.data.token || null;
  const guarded = probeTok
    ? await api('GET', '/api/merchant/services', undefined, probeTok)
    : { status: 401, note: 'no token to try' };
  check('MAFC-F2', 'no merchant services/tenant/entitlement surface opens for the refused phone',
    !probeTok || guarded.status === 401 || guarded.status === 403,
    { hadToken: !!probeTok, status: guarded.status });

  // no session persisted for the refused phone
  const sess = await one(`SELECT count(*)::text n FROM backend_sessions WHERE phone = $1`, [norm(UNREGISTERED)]);
  check('MAFC-F3', 'no durable session row was created for the refused phone',
    Number(sess.n) === 0, { sessions: sess.n });

  // ---- G: duplicate phone behaviour is OBSERVED, not changed (product decision) ----
  const dup = byPhone(DUPLICATE);
  const dupLogin = await otpLogin(DUPLICATE);
  const dupTok = dupLogin.data && dupLogin.data.token;
  let dupId = null;
  if (dupTok) {
    const me = await api('GET', '/api/auth/me', undefined, dupTok);
    dupId = String((me.data && me.user && me.user.id) || (me.data && me.data.user && (me.data.user.uuid || me.data.user.id)) || '');
  }
  // What this task actually verified about the duplicate phone, stated honestly:
  // before the fix, both rows' shared number authenticated as the IN-MEMORY seeded restaurant
  // (`rest_1`) - not as either durable merchant - because the durable lookup uses the
  // normalized 10-digit form while those rows store a `+91...` value. After the fix the same
  // number is refused consistently with no stand-in identity. So the invariant that must hold
  // is "never someone else's identity, and the same answer every time"; the underlying
  // phone-format / duplicate-number question is a separate product decision, NOT resolved or
  // papered over here.
  const dupSecond = await otpLogin(DUPLICATE);
  const dupTok2 = dupSecond.data && dupSecond.data.token;
  check('MAFC-G', 'the duplicate phone is answered consistently and never with a stand-in merchant identity',
    dup.length === 2 && (!!dupTok === !!dupTok2) && !dupTok && !dupTok2
      && !legitUuids.has(String(dupId || '')) && dupId !== 'rest_1',
    { rows_for_phone: dup.length, first_attempt_authenticated: !!dupTok, second_attempt_authenticated: !!dupTok2,
      resolved_before_fix_behaviour: dupId || '(refused)' });

  // ---- H: production behaviour, exercised against the same code path in-process.
  // The MERCHANT branch reads NODE_ENV when it runs, so flipping it here proves the
  // production path really refuses without booting a production-mode server (whose child
  // attempt produced no stdout, which is why the earlier version of this check could not
  // tell a refusal from a crash).
  const savedEnv = process.env.NODE_ENV;
  let prodIssued = false, prodCode = null, prodThrew = false;
  try {
    process.env.NODE_ENV = 'production';
    const r = await svc.verifyAuthOtp({ phone: UNREGISTERED, otp: OTP, role: 'MERCHANT', purpose: 'LOGIN' });
    prodIssued = !!(r && r.token);
  } catch (e) { prodThrew = true; prodCode = e && e.code || null; }
  finally { process.env.NODE_ENV = savedEnv; }
  check('MAFC-H', 'production mode refuses the unregistered phone (preserved, not newly introduced)',
    prodThrew && !prodIssued, { threw: prodThrew, code: prodCode });

  // ---- integrity: the shared seeded row was never touched, and these fixtures go away ----
  const seedTypeEnd = await seedTypeAt();
  check('MAFC-Y', 'the shared seeded merchant keeps the service type it had at start',
    seedTypeEnd === seedTypeStart, { seed_type: `${seedTypeStart}->${seedTypeEnd}` });
  const createdCount = fx.created.merchants.length;
  const removed = await fx.cleanup();
  const endMerchants = Number((await one('SELECT count(*)::text n FROM merchants')).n);
  const endJournal = await one(`SELECT (SELECT count(*) FROM journal_transactions)::text jt,
      (SELECT count(*) FROM journal_lines)::text jl, (SELECT count(*) FROM driver_payouts)::text po`);
  check('MAFC-Z', 'every fixture merchant created here is deleted again, no other row moved, no money moved',
    createdCount === 5 && removed.merchants === createdCount
      && endMerchants === startMerchants - createdCount
      && endJournal.jt === startJournal.jt
      && endJournal.jl === startJournal.jl && endJournal.po === startJournal.po,
    { created: createdCount, removed: removed.merchants,
      merchants: `${startMerchants}->${endMerchants}`, journal: `${startJournal.jt}->${endJournal.jt}` });

  await c.end();
  await fx.close();
  const failed = results.filter(r => !r.pass);
  const skipped = results.filter(r => r.pass !== true && r.pass !== false).length;
  console.log(`\n=== MERCHANT AUTH FAIL-CLOSED: ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed, ${skipped} skipped ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => {
  console.error('FATAL', e.message);
  // A crash halfway must not leave this suite's fixture rows behind for the next run to trip on.
  Promise.resolve(fxHandle && fxHandle.close())
    .catch(() => {})
    .finally(() => { process.exitCode = 1; });
});
