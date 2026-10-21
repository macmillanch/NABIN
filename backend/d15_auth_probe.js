// D15 probe 2: authorization edges on the payout routes. Read-only — every call tested here
// is expected to be refused, and a refusal writes nothing.
require('dotenv').config();
const { Client } = require('pg');
const BASE = 'http://127.0.0.1:4000/api';

async function hit(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, raw: text };
}
async function login(phone, role) {
  const s = await hit('POST', '/auth/send-otp', { body: { phone, role } });
  const otp = s.json?.testOtp ?? s.json?.data?.testOtp;
  if (!otp) return { error: `send-otp ${s.status} ${s.raw.slice(0, 140)}` };
  const v = await hit('POST', '/auth/verify-otp', { body: { phone, otp, role } });
  const token = v.json?.data?.token ?? v.json?.token;
  if (!token) return { error: `verify-otp ${v.status} ${v.raw.slice(0, 140)}` };
  return { token, user: v.json?.data?.user ?? v.json?.user };
}
const mask = (v) => (v == null ? 'null' : `<len ${String(v).length}>`);

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const cust = (await db.query(
    "select phone, name from public.users where id not in (select user_id from public.drivers where user_id is not null) " +
    "and phone is not null order by created_at limit 1")).rows[0];
  const pend = (await db.query(
    "select phone, kyc_status, (user_id is not null) as linked, id from public.drivers where kyc_status <> 'VERIFIED' order by created_at limit 1")).rows[0];
  console.log('targets:', JSON.stringify({ customerPhoneTail: String(cust?.phone).slice(-4), pendingDriver: { kyc: pend?.kyc_status, linked: pend?.linked } }));

  console.log('\n--- a CUSTOMER session against the driver payout routes ---');
  const c = await login(cust.phone, 'CUSTOMER');
  if (c.error) { console.log('customer login refused:', c.error); }
  else {
    console.log('customer user:', JSON.stringify({ id: c.user?.id, role: c.user?.role }));
    const g = await hit('GET', '/driver/earnings', { token: c.token });
    console.log('GET /driver/earnings ->', g.status, JSON.stringify(g.json));
    const w = await hit('POST', '/driver/payout-destination/request', { token: c.token, body: { upiId: 'not_a_vpa' } });
    console.log('POST payout-destination/request ->', w.status, JSON.stringify(w.json));
  }

  console.log('\n--- a driver whose KYC is not VERIFIED ---');
  const d = await login(pend.phone, 'DRIVER');
  if (d.error) { console.log('driver login refused:', d.error); }
  else {
    const g = await hit('GET', '/driver/earnings', { token: d.token });
    console.log('GET /driver/earnings ->', g.status, JSON.stringify(g.json).slice(0, 220));
    const w = await hit('POST', '/driver/payout-destination/request', { token: d.token, body: { upiId: 'not_a_vpa' } });
    console.log('POST payout-destination/request ->', w.status, JSON.stringify(w.json));
  }

  const residue = await db.query("select count(*)::int as n from public.drivers where pending_upi_id like 'd15probe%' or verified_upi_id like 'd15probe%'");
  console.log('\nd15probe residue rows:', residue.rows[0].n);
  const payouts = await db.query('select count(*)::int as n from public.driver_payouts');
  console.log('driver_payouts rows (baseline 293):', payouts.rows[0].n);
  const row = (await db.query("select pending_upi_id, payout_upi_verified, verified_upi_id, upi_cooling_until from public.drivers where id=$1", [pend.id])).rows[0];
  console.log('non-verified driver row after probes:', JSON.stringify({ pending: mask(row.pending_upi_id), verifiedFlag: row.payout_upi_verified, verified: mask(row.verified_upi_id), cooling: row.upi_cooling_until }));
  await db.end();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
