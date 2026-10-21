/*
 * MI-4 (P0) — an unenrolled phone must NOT be handed a driver identity.
 *
 * The defect and the standard it is held to:
 *   - verifyAuthOtp resolves the DRIVER entity by phone (in-memory find, then live
 *     `from('drivers').select('*').eq('phone', normPhone).maybeSingle()`). When NO driver matches,
 *     the DRIVER branch left `entity` undefined and STILL issued a session, because it lacked the
 *     `if (!entity) throw` refusal that the MERCHANT and ADMIN branches in the SAME function
 *     already carry (database.js MERCHANT guard describes the identical incident: a real store's
 *     identity handed to "any number that could complete an OTP challenge").
 *   - The session was stored with `entityId: 'anon'`. `authenticateDriver` then runs
 *     `session.entity || db.getDriver(session.entityId)`, and getDriver('anon') falls through its
 *     `|| this.drivers[0]` catch-all (database.js:4226) to the FIRST seeded driver.
 *   - Proven live against the local store: a DRIVER OTP for a phone with no driver row returned a
 *     token, and POST /api/driver/payout for that token resolved to the seeded driver (its wallet,
 *     its cooling), i.e. an unrecognized number was promoted to someone else's driver account.
 *
 * This suite holds five things true, at the auth layer where the elevation originates:
 *   A) an unenrolled DRIVER phone is REFUSED (typed 401, no session token minted) - the fix;
 *   B) a genuinely enrolled DRIVER still logs in, and the session binds to THAT driver's id, not
 *      drivers[0] - the guard must not break, or mis-aim, legitimate driver login;
 *   C) a persisted DRIVER row with no entity is declined at hydration, while one that carries its
 *      entity is still adopted - the pre-fix tokens were durable, not only in-process;
 *   D) the strict resolver the boundaries now call answers null for 'anon' and for any id it cannot
 *      resolve, while the shared getDriver catch-all is left alone for its traced non-auth callers;
 *   E) a role STRING that is not one of the four the branches match ('driver', 'ADMINISTRATOR') is
 *      refused too - it used to skip every branch and still mint an `entityId: 'anon'` bearer, and
 *      the case-insensitive consumers in server.js read its own spelling as an administrator;
 *   F) the hydration decline is keyed on the identity handle, not the role name, so an `anon` row
 *      under any other role cannot come back on boot either - while rows that carry their entity do.
 * The bearer-side half of the same defect is proven over HTTP in driver_identity_substitution_route_test.js.
 *
 * Local/test only. Refuses a non-loopback database. Runs via scripts/with_local_target.js.
 */
const { Client } = require('pg');

const PG = process.env.DATABASE_URL;
if (!PG || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('MI-4 REFUSED: needs a loopback DATABASE_URL (run via scripts/with_local_target.js)');
  process.exit(1);
}
const STAMP = Date.now();
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''));
}

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  const db = require('./src/database');

  if (!isLivePostgres || !supabaseAdmin) {
    console.log('[SKIP] MI-4 needs live PostgreSQL (run via with_local_target)');
    return finish();
  }

  // ---- A) an unenrolled DRIVER phone must be refused, with no session minted ----
  // A number in a band no seed or fixture uses; nothing is inserted for it.
  const ghostPhone = `99${String(STAMP).slice(-8)}`;
  const ghostNorm = db.normalizePhone(ghostPhone);
  const sessionsBefore = db.activeSessions ? db.activeSessions.size : 0;

  const send = await db.sendAuthOtp({ phone: ghostPhone, role: 'DRIVER', purpose: 'LOGIN' });
  let refusal = null, ghostToken = null;
  try {
    const v = await db.verifyAuthOtp({ phone: ghostPhone, otp: send.testOtp || '7729', role: 'DRIVER', purpose: 'LOGIN' });
    ghostToken = v && v.token;
  } catch (e) {
    refusal = e;
  }
  const sessionsAfter = db.activeSessions ? db.activeSessions.size : 0;

  check('MI4-01', 'verifyAuthOtp REFUSES a DRIVER login for an unenrolled phone', !!refusal,
    { threw: !!refusal, code: refusal && refusal.code, status: refusal && refusal.status });
  check('MI4-02', 'the refusal is a typed 401 (not a silent success)', !!refusal && refusal.status === 401,
    { code: refusal && refusal.code, status: refusal && refusal.status });
  check('MI4-03', 'no session token is minted for the unenrolled DRIVER', !ghostToken,
    { hasToken: !!ghostToken });
  check('MI4-04', 'no DRIVER session was registered for the unenrolled number', sessionsAfter <= sessionsBefore,
    { before: sessionsBefore, after: sessionsAfter, norm: ghostNorm });

  // Even if some earlier lenient path had left a session, no live DRIVER bearer may resolve to a
  // driver it never named. Assert the invariant the route boundaries actually rely on — the
  // session's own id resolves, under the strict resolver, to the driver the session carries — rather
  // than the shape "has an entity object". The distinction is measured, not assumed: the gated
  // non-production dev fixture `drv_session_rajesh` (database.js:215) has `entity: null` with
  // `entityId: 'DRV-101'`, so an earlier predicate keyed on `!entity` reddened on it while the
  // pre-fix `entityId: 'anon'` row was still resolving to drivers[0]. A hard-coded development
  // token is a different risk class from an identity substitution, and this check is about the
  // substitution: getDriverStrict returns null for anything unresolved.
  const unresolved = Array.from(db.activeSessions ? db.activeSessions.values() : [])
    .filter(s => s && s.role === 'DRIVER')
    .filter((s) => {
      const byId = db.getDriverStrict(s.entityId);
      if (!byId) return true;
      const claimed = s.entity && s.entity.id;
      return !!claimed && String(byId.id) !== String(claimed);
    })
    .map(s => ({ entityId: s.entityId, entityNull: !s.entity }));
  const anonBound = unresolved.length > 0;
  check('MI4-05', 'no live DRIVER session resolves to a driver it does not name (no drivers[0] fall-through)',
    !anonBound, { unresolved, firstSeed: db.drivers && db.drivers[0] && db.drivers[0].id });

  // ---- B) a genuinely enrolled DRIVER still logs in, bound to ITS OWN id (no regression) ----
  const realRaw = `71${String(STAMP).slice(-8)}`;        // what the app would type
  const realNorm = db.normalizePhone(realRaw);            // how the driver row must be stored
  const usr = await supabaseAdmin.from('users').insert({
    name: `MI-4 enrolled driver user ${STAMP}`, phone: realNorm
  }).select('id').single();
  if (usr.error || !usr.data) { console.error('FATAL: user insert refused ' + JSON.stringify(usr.error)); process.exit(1); }
  const drv = await supabaseAdmin.from('drivers').insert({
    user_id: usr.data.id, name: `MI-4 enrolled driver ${STAMP}`, phone: realNorm,
    vehicle_type: 'AUTO', vehicle_number: `MI${String(STAMP).slice(-6)}`, operational_status: 'AVAILABLE',
    wallet_balance: 1000, kyc_status: 'VERIFIED', payout_upi_verified: false
  }).select('id').single();
  if (drv.error || !drv.data) { console.error('FATAL: driver insert refused ' + JSON.stringify(drv.error)); process.exit(1); }
  const drvId = drv.data.id;

  const send2 = await db.sendAuthOtp({ phone: realRaw, role: 'DRIVER', purpose: 'LOGIN' });
  let v2 = null, err2 = null;
  try {
    v2 = await db.verifyAuthOtp({ phone: realRaw, otp: send2.testOtp || '7729', role: 'DRIVER', purpose: 'LOGIN' });
  } catch (e) { err2 = e; }
  check('MI4-06', 'a legitimately enrolled DRIVER can log in', !!v2 && !!v2.token && !err2,
    { hasToken: !!(v2 && v2.token), err: err2 && err2.code });

  const sess = v2 && v2.token ? db.getSessionByToken(v2.token) : null;
  const boundId = sess && (sess.entityId || (sess.entity && sess.entity.id));
  check('MI4-07', 'the DRIVER session binds to THAT driver id, not drivers[0]',
    !!sess && String(boundId) === String(drvId), { boundId, drvId, firstSeed: db.drivers && db.drivers[0] && db.drivers[0].id });

  // ---- C) the durable half: a pre-fix row must not come back as a session on boot ----
  // hydrateSessions() and reconcileSessions() both adopt through restoreSession(), which used to
  // take any row with a future expires_at — so an `anon` DRIVER row minted before the fix survived
  // a restart and kept honouring its bearer for the rest of its 30-day TTL. Measured on this store:
  // 179 live DRIVER rows with entity IS NULL, every one of them entity_id='anon', and DRIVER the only
  // role with any null-entity rows at all. Proved directly on the row shape rather than via HTTP.
  const future = new Date(Date.now() + 600000).toISOString();
  const declinedToken = `mi4declined${STAMP}`;
  const mapBefore = db.activeSessions.size;
  const declined = db.restoreSession({
    token_hash: declinedToken, role: 'DRIVER', entity_id: 'anon', phone: ghostNorm,
    entity: null, created_at: new Date().toISOString(), expires_at: future
  });
  check('MI4-08', 'restoreSession DECLINES a persisted DRIVER row whose entity is null',
    declined === false && !db.activeSessions.has(declinedToken) && db.activeSessions.size === mapBefore,
    { returned: declined, present: db.activeSessions.has(declinedToken), before: mapBefore, after: db.activeSessions.size });

  // The refusal must be aimed at the shape, not at DRIVER sessions generally: a row that carries
  // its driver still hydrates, or legitimate drivers would be signed out by every restart.
  const adoptedToken = `mi4adopted${STAMP}`;
  const adopted = db.restoreSession({
    token_hash: adoptedToken, role: 'DRIVER', entity_id: String(drvId), phone: realNorm,
    entity: { id: String(drvId), role: 'DRIVER' }, created_at: new Date().toISOString(), expires_at: future
  });
  check('MI4-09', 'restoreSession still adopts a DRIVER session that carries its entity',
    adopted === true && db.activeSessions.has(adoptedToken),
    { returned: adopted, present: db.activeSessions.has(adoptedToken) });
  db.activeSessions.delete(adoptedToken);

  // ---- D) the resolver the boundaries now call, on its own ----
  // The route fix is `session.entity || db.getDriverStrict(session.entityId)`, so the resolver's
  // answer is the whole refusal. Pinned directly because once hydration declines an entity-less row
  // the HTTP boundary refuses that bearer one step earlier, as an unknown session: over the wire the
  // identity branch is shadowed by the layer above it, and a guard nobody reaches is a guard nobody
  // verifies. `getDriver` is deliberately left as it was — traced non-auth callers depend on its
  // catch-all — so the pair is asserted together: the fallback still resolves for the old method and
  // no longer does for the one a security boundary uses.
  const firstSeedId = db.drivers && db.drivers[0] && db.drivers[0].id;
  const strictAnon = db.getDriverStrict('anon');
  const strictUnknown = db.getDriverStrict('DRV-DOES-NOT-EXIST');
  const strictEmpty = [null, undefined, ''].map(v => db.getDriverStrict(v));
  check('MI4-10', 'getDriverStrict answers null for the identifiers that used to reach drivers[0]',
    strictAnon === null && strictUnknown === null && strictEmpty.every(v => v === null),
    { anon: strictAnon, unknown: strictUnknown, empty: strictEmpty });
  check('MI4-11', 'the shared getDriver catch-all is unchanged, so its non-auth callers keep working',
    db.getDriver('anon') && String(db.getDriver('anon').id) === String(firstSeedId),
    { legacyReturned: db.getDriver('anon') && db.getDriver('anon').id, firstSeed: firstSeedId });
  const strictOwn = db.getDriverStrict(String(drvId));
  const strictSeed = db.getDriverStrict('DRV-101');
  check('MI4-12', 'getDriverStrict resolves a real driver id to that driver, not a fallback',
    !!strictOwn && String(strictOwn.id) === String(drvId) && !!strictSeed && String(strictSeed.id) === 'DRV-101',
    { own: strictOwn && strictOwn.id, seed: strictSeed && strictSeed.id });

  // ---- E) the role STRING is not a spelling of the identity ----
  // The four branches above are matched on the exact strings 'CUSTOMER', 'DRIVER', 'MERCHANT',
  // 'ADMIN' | 'SUPER_ADMIN'. role arrives from the request body (server.js /api/auth/send-otp and
  // /api/auth/verify-otp pass it through untouched) and the chain has no final else, so any other
  // spelling — 'driver', 'admin ', 'ADMINISTRATOR' — resolved nothing, skipped every branch's
  // refusal, and STILL reached the mint with `entityId: 'anon'` and a token prefix built out of the
  // client's own string. That bearer is inert at authenticateDriver/ authenticateUser/
  // authenticateMerchant (all three compare to the canonical constant), which is why the DRIVER
  // guard above does not cover it — but server.js:7307 and :9551 read the role through
  // `.toUpperCase()` before deciding it is an ADMIN, and WS REGISTER does the same at :472, so the
  // mint was handing an unverified identity to the case-insensitive boundaries.
  const anonBefore = Array.from(db.activeSessions.values()).filter(s => String(s.entityId) === 'anon').length;
  const looseRoles = [{ id: 'MI4-13', role: 'driver' }, { id: 'MI4-14', role: 'ADMINISTRATOR' }];
  for (const { id, role: looseRole } of looseRoles) {
    const sendL = await db.sendAuthOtp({ phone: ghostPhone, role: looseRole, purpose: 'LOGIN' });
    let tok = null, errL = null;
    try {
      const v = await db.verifyAuthOtp({ phone: ghostPhone, otp: sendL.testOtp || '7729', role: looseRole, purpose: 'LOGIN' });
      tok = v && v.token;
    } catch (e) { errL = e; }
    check(id, `verifyAuthOtp REFUSES the non-canonical role '${looseRole}' with a typed 401 and mints no token`,
      !!errL && errL.status === 401 && !tok, { code: errL && errL.code, status: errL && errL.status, hasToken: !!tok });
  }
  // The same spelling aimed at a phone that DOES hold a driver is refused too: the guard is about
  // the role string never reaching a mint without a resolved entity, not about the number being bad.
  const sendE = await db.sendAuthOtp({ phone: realRaw, role: 'driver', purpose: 'LOGIN' });
  let looseReal = null, looseRealErr = null;
  try {
    looseReal = await db.verifyAuthOtp({ phone: realRaw, otp: sendE.testOtp || '7729', role: 'driver', purpose: 'LOGIN' });
  } catch (e) { looseRealErr = e; }
  const anonAfter = Array.from(db.activeSessions.values()).filter(s => String(s.entityId) === 'anon').length;
  check('MI4-15', 'no anon-identity session was minted by any role spelling in this run',
    !!looseRealErr && !looseReal && anonAfter === anonBefore && anonBefore === 0,
    { code: looseRealErr && looseRealErr.code, anonBefore, anonAfter, granted: !!(looseReal && looseReal.token) });

  // ---- F) the durable half, for the roles the DRIVER clause does not name ----
  // Pre-fix rows are durable, so a `DRIVER` decline alone leaves an `admin`/`ADMINISTRATOR` anon row
  // hydrating on every boot for the rest of its 30-day TTL, and the case-insensitive boundaries above
  // read it as a real bearer. The decline has to be about the identity handle, not the role name.
  const anonMerchantToken = `mi4anonmkt${STAMP}`;
  const adoptedAnonMerchant = db.restoreSession({
    token_hash: anonMerchantToken, role: 'MERCHANT', entity_id: 'anon', phone: ghostNorm,
    entity: null, created_at: new Date().toISOString(), expires_at: future
  });
  check('MI4-16', 'restoreSession declines a persisted non-DRIVER row whose identity is anon',
    adoptedAnonMerchant === false && !db.activeSessions.has(anonMerchantToken),
    { returned: adoptedAnonMerchant, present: db.activeSessions.has(anonMerchantToken) });

  // and the broadened decline must still be aimed at the shape: a CUSTOMER row carrying its entity
  // has to come back, or every restart would sign real customers out.
  const custToken = `mi4cust${STAMP}`;
  const adoptedCust = db.restoreSession({
    token_hash: custToken, role: 'CUSTOMER', entity_id: `usr_${String(STAMP).slice(-5)}`, phone: ghostNorm,
    entity: { id: `usr_${String(STAMP).slice(-5)}`, role: 'CUSTOMER' },
    created_at: new Date().toISOString(), expires_at: future
  });
  check('MI4-17', 'restoreSession still adopts a CUSTOMER session that carries its entity',
    adoptedCust === true && db.activeSessions.has(custToken),
    { returned: adoptedCust, present: db.activeSessions.has(custToken) });
  db.activeSessions.delete(custToken);

  // cleanup the disposable rows (this run owns them; guarded)
  const c = new Client({ connectionString: PG }); await c.connect();
  try {
    await c.query(`DELETE FROM drivers WHERE id=$1::uuid
      AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text)
      AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)`, [drvId]);
    await c.query('DELETE FROM users WHERE id=$1::uuid AND NOT EXISTS (SELECT 1 FROM drivers WHERE user_id=$1::uuid)', [usr.data.id]);
  } catch (e) { console.log('  cleanup note: ' + e.message); }
  await c.end();

  return finish();
})().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exitCode = 1; });

function finish() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== MI-4 UNENROLLED DRIVER ELEVATION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
