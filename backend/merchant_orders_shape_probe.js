/**
 * Merchant-orders shape probe — READ-ONLY.
 *
 * Establishes, by measurement, what GET /api/merchant/:restaurantId/orders hands the Restaurant
 * Merchant KDS tab: the field names on a real row, and whether the keys the card reads
 * (`status`, `items`, `time`, `customer`, `type`, `driver`, `pickupOtp`) exist at all.
 *
 * No writes, no mutations, no schema access beyond a read of the same table the route reads.
 * Local development backend only. Run from backend/:  node merchant_orders_shape_probe.js
 */
const http = require('http');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const MERCHANTS = [
  { label: 'A', phone: '9811223344' },
  { label: 'B', phone: '9871133479' },
];

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);
    const payload = body === null || body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data.slice(0, 200) }; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', (e) => resolve({ status: 0, data: { error: e.message } }));
    if (payload) req.write(payload);
    req.end();
  });
}
const tok = (t) => ({ Authorization: `Bearer ${t}` });

async function login(phone) {
  const send = await request('POST', '/api/auth/send-otp', { phone, role: 'MERCHANT', purpose: 'LOGIN' });
  if (!send.data || send.data.success !== true) return null;
  const verify = await request('POST', '/api/auth/verify-otp', {
    phone, otp: send.data.testOtp || '7729', role: 'MERCHANT', purpose: 'LOGIN',
  });
  return (verify.data && verify.data.token) || null;
}

// The keys the KDS card reads off an order row, and the ones the brief names as suspects.
const CARD_KEYS = ['id', 'status', 'items', 'time', 'customer', 'type', 'driver', 'pickupOtp'];

(async () => {
  const health = await request('GET', '/api/health');
  console.log('target:', BASE_URL, '| db mode:', health.data?.database?.mode);

  for (const m of MERCHANTS) {
    console.log('\n================ merchant', m.label, '================');
    const token = await login(m.phone);
    if (!token) { console.log('login failed'); continue; }

    const services = await request('GET', '/api/merchant/services', null, tok(token));
    const merchantId = services.data?.merchantId;
    console.log('merchantId:', merchantId, '| services:', JSON.stringify(services.data?.services));
    if (!merchantId) continue;

    const orders = await request('GET', `/api/merchant/${merchantId}/orders`, null, tok(token));
    const rows = orders.data?.orders || [];
    console.log('GET /api/merchant/:id/orders ->', orders.status,
      '| top-level keys:', Object.keys(orders.data || {}).join(','),
      '| count:', orders.data?.count);
    if (!rows.length) { console.log('no order rows for this merchant'); continue; }

    const first = rows[0];
    console.log('row field names:', Object.keys(first).join(','));
    console.log('line field names:', Object.keys(first.lines?.[0] || first.order_lines?.[0] || {}).join(','));
    console.log('states present:', JSON.stringify([...new Set(rows.map(r => r.order_state))]));
    for (const k of CARD_KEYS) {
      console.log(`  card reads order['${k}'] ->`, k in first ? `PRESENT (${JSON.stringify(first[k])?.slice(0, 80)})` : 'ABSENT');
    }
    console.log('full first row:', JSON.stringify(first).slice(0, 1400));

    const withDriver = rows.filter(r => r.driver !== undefined || r.driver_id !== undefined);
    const withOtp = rows.filter(r => r.pickupOtp !== undefined || r.pickup_otp !== undefined);
    console.log('rows carrying a driver field:', withDriver.length, '| carrying a pickup otp field:', withOtp.length);
  }
  console.log('\nprobe complete (read-only).');
})();
