// =========================================================================
// PAYMENT VERIFIER CONFIGURATION SEMANTICS (local only)
//
// Both payment verifiers used to fall back to a key written in the source, and
// only refused when NODE_ENV was exactly 'production'. So a beta, a staging
// box or a laptop verified "this ride is paid for" against a secret anyone who
// can read the repository can sign with — and the refusal that did exist said
// "unconfigured" in a 500 while a bad signature says it in a 400, which is the
// same answer shape for two completely different problems.
//
// The two rules this file pins:
//   1. A server that cannot verify says so as an infrastructure condition
//      (503), in every environment, and never as a rejected signature — a
//      client must not read the operator's misconfiguration as its own failure.
//   2. A server that can verify answers a bad signature as a client error
//      (4xx). The class must track the cause, both ways.
//
// The signatures below are computed with a key this server was deliberately
// never given. The old fallback strings are not repeated here on purpose: the
// point is that no key printed in this repository authorises anything any more,
// and re-typing them would put a credential-shaped literal back into source.
//
// Nothing here touches a hosted environment. Both processes are spawned on
// 127.0.0.1 against the local database, on ports no other suite uses.
// =========================================================================

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const NOT_GIVEN_KEY = 'a-key-this-server-was-never-given';
const TEST_WEBHOOK_SECRET = 'test_webhook_secret_not_for_deployment';
const TEST_KEY_SECRET = 'test_key_secret_not_for_deployment';

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

function request(port, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data } }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Start a real backend whose payment configuration is decided here rather than
 * inherited, so "unconfigured" means the process genuinely has no key.
 */
function startServer(port, { configured }) {
  const env = { ...process.env, PORT: String(port), NABIN_TEST_MODE: 'true' };
  delete env.PAYMENT_WEBHOOK_SECRET;
  delete env.PAYMENT_KEY_SECRET;
  if (configured) {
    env.PAYMENT_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    env.PAYMENT_KEY_SECRET = TEST_KEY_SECRET;
  }
  const logs = { text: '' };
  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    env, stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', (chunk) => { logs.text += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { logs.text += chunk.toString(); });
  return { proc, logs };
}

/**
 * One backend at a time. Two processes that each restore their state from the
 * same local database and flush it back on write are not a safe thing to run
 * concurrently, so the configured half waits for the unconfigured half to exit.
 */
async function withServer(port, options, body) {
  const server = startServer(port, options);
  try {
    const up = await waitForHealth(port, server.proc);
    if (!up) {
      check('VF-00', false, `backend on :${port} never became healthy (exit ${server.proc.exitCode})`);
      console.log(server.logs.text.slice(-1500));
      return;
    }
    await body(server);
  } finally {
    server.proc.kill();
    await new Promise(resolve => server.proc.once('exit', resolve));
  }
}

async function waitForHealth(port, proc, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) return false;
    try {
      const res = await request(port, 'GET', '/api/health');
      if (res.status === 200) return true;
    } catch (e) { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function customerToken(port) {
  const phone = '9876543210';
  const sent = await request(port, 'POST', '/api/auth/send-otp', { phone, role: 'CUSTOMER', purpose: 'LOGIN' });
  const verified = await request(port, 'POST', '/api/auth/verify-otp', {
    phone, otp: sent.body?.testOtp || '7729', role: 'CUSTOMER'
  });
  return verified.body?.token;
}

async function main() {
  console.log('========================================================================');
  console.log('🔐 NABIN PAYMENT VERIFIER CONFIGURATION SEMANTICS');
  console.log('========================================================================\n');

  const UNCONFIGURED_PORT = 4111;
  const CONFIGURED_PORT = 4112;

  // --- a backend with no payment keys at all ---------------------------------
  await withServer(UNCONFIGURED_PORT, { configured: false }, async (server) => {
    const noSig = await request(UNCONFIGURED_PORT, 'POST', '/api/payments/webhook', { event: 'payment.captured' });
    check('VF-01', noSig.status === 400 && noSig.body.code === 'MISSING_SIGNATURE',
      `a request with no signature header is still the client's own error, not the server's (got ${noSig.status} ${noSig.body.code})`);

    const forgedSig = crypto.createHmac('sha256', NOT_GIVEN_KEY).update(JSON.stringify({ event: 'payment.captured' })).digest('hex');
    const unconfiguredWebhook = await request(UNCONFIGURED_PORT, 'POST', '/api/payments/webhook',
      { event: 'payment.captured' }, { 'x-razorpay-signature': forgedSig });
    check('VF-02', unconfiguredWebhook.status === 503 && unconfiguredWebhook.body.code === 'WEBHOOK_NOT_CONFIGURED',
      `a webhook on an unconfigured server answers 503 WEBHOOK_NOT_CONFIGURED, so a gateway retries rather than gives up (got ${unconfiguredWebhook.status} ${unconfiguredWebhook.body.code})`);

    const webhookBody = JSON.stringify(unconfiguredWebhook.body).toLowerCase();
    check('VF-03', !webhookBody.includes(NOT_GIVEN_KEY) && !webhookBody.includes('hmac') && !webhookBody.includes('expected'),
      'the refusal names the condition without echoing a key, an algorithm or an expected signature');
    check('VF-04', /PAYMENT_WEBHOOK_SECRET is not configured/.test(server.logs.text),
      'the diagnostic that tells an operator what to fix is in the log, where the client cannot see it');

    const token = await customerToken(UNCONFIGURED_PORT);
    check('VF-05', Boolean(token), 'a customer session exists on the unconfigured backend');
    const auth = { Authorization: `Bearer ${token}` };

    const created = await request(UNCONFIGURED_PORT, 'POST', '/api/payments/create-order', {
      amount: 145.0, currency: 'INR', serviceType: 'RIDE', jobId: `JOB-VFC-${Date.now()}`
    }, auth);
    const orderId = created.body?.session?.orderId;
    check('VF-06', created.status === 200 && Boolean(orderId) && created.body.session.status === 'PAYMENT_PENDING',
      `an order can still be opened while verification is unconfigured — refusing to take money is not a reason to stop selling (got ${created.status}, ${orderId})`);

    const checkoutSig = crypto.createHmac('sha256', NOT_GIVEN_KEY).update(`${orderId}|pay_vfc_1`).digest('hex');
    const unconfiguredVerify = await request(UNCONFIGURED_PORT, 'POST', '/api/payments/verify-checkout', {
      orderId, paymentId: 'pay_vfc_1', signature: checkoutSig, status: 'SUCCESS'
    }, auth);
    check('VF-07', unconfiguredVerify.status === 503 && unconfiguredVerify.body.code === 'PAYMENT_VERIFIER_UNCONFIGURED',
      `a checkout cannot be marked paid on an unconfigured server, and the reason given is the server's (got ${unconfiguredVerify.status} ${unconfiguredVerify.body.code})`);

    const stillPending = await request(UNCONFIGURED_PORT, 'GET', `/api/payments/session/${orderId}`, null, auth);
    check('VF-08', stillPending.status === 200 && stillPending.body?.session?.status === 'PAYMENT_PENDING',
      `the refusal wrote nothing — the session is still PAYMENT_PENDING (got ${stillPending.body?.session?.status})`);

    // A signature this file cannot tell from a genuine one must be refused as
    // unverifiable, not accepted because it looks well-formed.
    const wellFormedSig = crypto.createHmac('sha256', NOT_GIVEN_KEY).update(`${orderId}|pay_vfc_2`).digest('hex');
    const blindSecond = await request(UNCONFIGURED_PORT, 'POST', '/api/payments/verify-checkout', {
      orderId, paymentId: 'pay_vfc_2', signature: wellFormedSig, status: 'SUCCESS'
    }, auth);
    check('VF-09', blindSecond.status === 503 && blindSecond.body?.code === 'PAYMENT_VERIFIER_UNCONFIGURED',
      `a signature indistinguishable from a real one is refused as unverifiable rather than accepted (got ${blindSecond.status} ${blindSecond.body?.code})`);
  });

  // --- the same two paths, with the keys present ------------------------------
  await withServer(CONFIGURED_PORT, { configured: true }, async () => {
    const forgedSig = crypto.createHmac('sha256', NOT_GIVEN_KEY)
      .update(JSON.stringify({ event: 'payment.captured' })).digest('hex');
    const wrongSig = await request(CONFIGURED_PORT, 'POST', '/api/payments/webhook',
      { event: 'payment.captured' }, { 'x-razorpay-signature': forgedSig });
    check('VF-10', wrongSig.status !== 503 && wrongSig.body?.code !== 'WEBHOOK_NOT_CONFIGURED',
      `with the key present the same webhook is judged on its signature, not on configuration (got ${wrongSig.status} ${wrongSig.body?.code})`);

    const token = await customerToken(CONFIGURED_PORT);
    const auth = { Authorization: `Bearer ${token}` };
    const order = await request(CONFIGURED_PORT, 'POST', '/api/payments/create-order', {
      amount: 145.0, currency: 'INR', serviceType: 'RIDE', jobId: `JOB-VFD-${Date.now()}`
    }, auth);
    const orderId = order.body?.session?.orderId;
    check('VF-11', order.status === 200 && Boolean(orderId),
      `a payment order was opened on the configured control backend (${orderId})`);

    const badSig = crypto.createHmac('sha256', NOT_GIVEN_KEY).update(`${orderId}|pay_vfd_1`).digest('hex');
    const badVerify = await request(CONFIGURED_PORT, 'POST', '/api/payments/verify-checkout', {
      orderId, paymentId: 'pay_vfd_1', signature: badSig, status: 'SUCCESS'
    }, auth);
    check('VF-12', badVerify.status === 400 && badVerify.body?.code === 'INVALID_SIGNATURE',
      `a wrong signature on a configured server is a 4xx about the client's signature (got ${badVerify.status} ${badVerify.body?.code})`);

    const goodSig = crypto.createHmac('sha256', TEST_KEY_SECRET).update(`${orderId}|pay_vfd_2`).digest('hex');
    const goodVerify = await request(CONFIGURED_PORT, 'POST', '/api/payments/verify-checkout', {
      orderId, paymentId: 'pay_vfd_2', signature: goodSig, status: 'SUCCESS'
    }, auth);
    check('VF-13', goodVerify.status === 200 && goodVerify.body?.status === 'PAYMENT_SUCCESS',
      `and the endpoint still accepts the signature the configured key actually produces (got ${goodVerify.status} ${goodVerify.body?.status})`);
  });

  const failed = results.filter(r => !r.ok).length;
  console.log('\n========================================================================');
  console.log(`📊 PAYMENT VERIFIER CONFIG: ${results.length - failed} PASSED, ${failed} FAILED (Total: ${results.length})`);
  console.log('========================================================================\n');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  check('VF-99', false, `harness threw: ${err.message}`);
  console.error(err);
  process.exitCode = 1;
});
