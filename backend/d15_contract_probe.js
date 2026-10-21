// D15 live contract probe. Read-mostly; the only writes are two payout-destination
// REQUESTs on the seeded dev driver DRV-103, reverted by one scoped UPDATE at the end.
// No payout, no gateway, no settlement row, no trigger bypass.
require('dotenv').config();
const { Client } = require('pg');

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:4000/api';
const mask = (v) => (v === null || v === undefined ? 'null' : `<len ${String(v).length}> ${String(v).slice(0, 2)}…${String(v).slice(-2)}`);

async function hit(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, raw: text };
}

async function login(phone) {
  const sent = await hit('POST', '/auth/send-otp', { body: { phone, role: 'DRIVER' } });
  const otp = sent.json?.testOtp ?? sent.json?.data?.testOtp;
  if (!otp) throw new Error(`send-otp did not yield a testOtp: ${sent.status} ${sent.raw.slice(0, 160)}`);
  const ver = await hit('POST', '/auth/verify-otp', { body: { phone, otp, role: 'DRIVER' } });
  const token = ver.json?.data?.token ?? ver.json?.token;
  const user = ver.json?.data?.user ?? ver.json?.user;
  if (!token) throw new Error(`verify-otp failed: ${ver.status} ${ver.raw.slice(0, 200)}`);
  return { token, user };
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const readRow = async () => (await db.query(
    'select id, name, user_id, kyc_status, verified_upi_id, pending_upi_id, payout_upi_verified, upi_cooling_until ' +
    "from public.drivers where id = '00000000-0000-0000-0000-000000000103'")).rows[0];

  const before = await readRow();
  console.log('PRE-STATE DRV-103:', JSON.stringify({
    name: before.name, kyc: before.kyc_status, linked: Boolean(before.user_id),
    verified_upi: mask(before.verified_upi_id), payout_upi_verified: before.payout_upi_verified,
    pending_upi: mask(before.pending_upi_id), cooling: before.upi_cooling_until,
  }));

  const drv = await login('9833344556');
  console.log('LOGIN:', JSON.stringify({ id: drv.user.id, name: drv.user.name, role: drv.user.role, tokenLen: drv.token.length }));

  console.log('\n--- READ: GET /api/driver/earnings (own session) ---');
  const earn = await hit('GET', '/driver/earnings', { token: drv.token });
  console.log('status', earn.status, 'success', earn.json?.success, 'source', earn.json?.source);
  const p = earn.json?.payout || {};
  console.log('payout block:', JSON.stringify({
    destination: mask(p.destination), destinationVerified: p.destinationVerified,
    pendingDestination: mask(p.pendingDestination), coolingUntil: p.destinationCoolingUntil,
    kycStatus: p.kycStatus, operationalStatus: p.operationalStatus,
  }));
  console.log('top-level keys:', Object.keys(earn.json || {}).join(','));
  console.log('transactions present?', Array.isArray(earn.json?.transactions), 'len', (earn.json?.transactions || []).length);
  console.log('transactions sample kinds:', JSON.stringify((earn.json?.transactions || []).slice(0, 3).map(t => ({ id: t.id, type: t.type, title: t.title, amount: t.amount, settlementStatus: t.settlementStatus }))));

  console.log('\n--- READ refusals ---');
  const noTok = await hit('GET', '/driver/earnings');
  console.log('no token ->', noTok.status, JSON.stringify(noTok.json));
  const badTok = await hit('GET', '/driver/earnings', { token: 'not-a-real-token' });
  console.log('bad token ->', badTok.status, JSON.stringify(badTok.json));

  console.log('\n--- WRITE refusals: POST /api/driver/payout-destination/request ---');
  const wNo = await hit('POST', '/driver/payout-destination/request', { body: { upiId: 'd15probevalid@okaxis' } });
  console.log('no token ->', wNo.status, JSON.stringify(wNo.json));
  const wBad = await hit('POST', '/driver/payout-destination/request', { token: 'not-a-real-token', body: { upiId: 'd15probevalid@okaxis' } });
  console.log('bad token ->', wBad.status, JSON.stringify(wBad.json));
  const wFmt = await hit('POST', '/driver/payout-destination/request', { token: drv.token, body: { upiId: 'bad_vpa_without_bank' } });
  console.log('bad format ->', wFmt.status, JSON.stringify(wFmt.json));
  const wEmpty = await hit('POST', '/driver/payout-destination/request', { token: drv.token, body: { upiId: '' } });
  console.log('empty ->', wEmpty.status, JSON.stringify(wEmpty.json));
  const wNone = await hit('POST', '/driver/payout-destination/request', { token: drv.token, body: {} });
  console.log('no field ->', wNone.status, JSON.stringify(wNone.json));
  const longVpa = `${'d'.repeat(101)}@okabc`;
  const wLong = await hit('POST', '/driver/payout-destination/request', { token: drv.token, body: { upiId: longVpa } });
  console.log('regex-valid but over the varchar(100) column ->', wLong.status, JSON.stringify(wLong.json));
  const afterRefusals = await readRow();
  console.log('row after refusals unchanged?',
    afterRefusals.pending_upi_id === before.pending_upi_id && afterRefusals.payout_upi_verified === before.payout_upi_verified);

  console.log('\n--- WRITE accepted (two probe requests, both reverted below) ---');
  const w1 = await hit('POST', '/driver/payout-destination/request', { token: drv.token, body: { upiId: 'd15probeone@okxyz' } });
  console.log('request 1 ->', w1.status, JSON.stringify(w1.json));
  const mid = await readRow();
  console.log('row after 1:', JSON.stringify({ pending: mask(mid.pending_upi_id), verifiedFlag: mid.payout_upi_verified, verifiedUpi: mask(mid.verified_upi_id), cooling: mid.upi_cooling_until }));
  const earn2 = await hit('GET', '/driver/earnings', { token: drv.token });
  console.log('read back payout:', JSON.stringify({
    destination: mask(earn2.json?.payout?.destination), destinationVerified: earn2.json?.payout?.destinationVerified,
    pendingDestination: mask(earn2.json?.payout?.pendingDestination) }));
  const w2 = await hit('POST', '/driver/payout-destination/request', { token: drv.token, body: { upiId: 'd15probetwo@okxyz', driverId: 'DRV-101', userId: '00000000-0000-0000-0000-000000000101' } }
  );
  console.log('request 2 (with another driver ids in the body) ->', w2.status, JSON.stringify(w2.json));
  const other = (await db.query("select pending_upi_id, payout_upi_verified from public.drivers where id='00000000-0000-0000-0000-000000000101'")).rows[0];
  console.log('DRV-101 untouched?', other.pending_upi_id === null, 'its verified flag:', other.payout_upi_verified);
  const afterOwn = await hit('POST', '/driver/payout-destination/request', { body: { upiId: 'd15probeone@okxyz' } });
  console.log('unauthenticated write ->', afterOwn.status, JSON.stringify(afterOwn.json));

  console.log('\n--- REVERT ---');
  const rev = await db.query(
    'update public.drivers set pending_upi_id=$1, payout_upi_verified=$2 where id=$3::uuid returning pending_upi_id, payout_upi_verified',
    [before.pending_upi_id, before.payout_upi_verified, '00000000-0000-0000-0000-000000000103']);
  console.log('reverted rows:', rev.rowCount, JSON.stringify({ pending: mask(rev.rows[0]?.pending_upi_id), verifiedFlag: rev.rows[0]?.payout_upi_verified }));
  const final = await readRow();
  console.log('RESTORE EXACT:', JSON.stringify({
    pendingMatches: final.pending_upi_id === before.pending_upi_id,
    verifiedFlagMatches: final.payout_upi_verified === before.payout_upi_verified,
    verifiedUpiMatches: final.verified_upi_id === before.verified_upi_id,
    coolingMatches: String(final.upi_cooling_until) === String(before.upi_cooling_until),
  }));
  const leftover = await db.query(
    "select count(*)::int as n from public.drivers where pending_upi_id like 'd15probe%' or verified_upi_id like 'd15probe%'");
  console.log('probe residue rows:', leftover.rows[0].n);
  const payouts = await db.query('select count(*)::int as n from public.driver_payouts');
  console.log('driver_payouts rows (must be unchanged at 293):', payouts.rows[0].n);

  await db.end();
  process.exit(0);
})().catch(async (e) => { console.error('ERR', e.message); process.exit(1); });
