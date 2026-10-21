/*
 * A grocery order exists when the checkout route says it exists, and nowhere else.
 *
 * The defect this file was written for is in `customer-web/src/app/grocery/page.tsx`. Its submit
 * handler looked at the store id in the "Partner Store" field and, if it began with `mcht-demo` or
 * `demo-`, finished the order in the browser: a `setTimeout` of 500 ms produced
 * `{ id: 'DEMO-GRC-9912', order_number: 'DEMO-GROCERY-9912', status: 'CONFIRMED' }`, cleared the
 * cart, and painted a success receipt — with `finalTotal` read from the cart's own arithmetic, an
 * invented "Paid from Wallet" or "Cash on Delivery" line, and a "Track it in My orders" link to a
 * history page that would never show the order. `POST /api/grocery/checkout/validate` was never
 * called, so no `checkouts` row and no `orders` row were written, no merchant was notified, no
 * coupon was redeemed, and nothing was charged.
 *
 * Why this is the worst version of that pattern rather than a harmless mock:
 *  - It was the DEFAULT path, not an opt-in. `storeId` is initialised to `'mcht-demo-grocery-1'`,
 *    so the first order a customer places on this screen is fabricated unless they notice a
 *    pre-filled text box and overtype it. Nothing on the receipt says demo.
 *  - It bypasses every gate the route enforces: merchant resolution and type, the MI-5 approval
 *    check, the MI-6b closure check, the empty-cart rule, the GRO-ADDR `PLACE_REQUIRED` rule, the
 *    coupon redemption, and both durable writes. A closed or unapproved store still says CONFIRMED.
 *  - `deliveryAddress` is initialised to `'Flat 402, Civil Lines, Delhi'`, so the address the
 *    customer never chose is what gets posted by the real path too — that pre-fill is exactly the
 *    side of the boundary the server refusal was written to close.
 *
 * Two rules shape the guard, and they pull against each other:
 *  - The page has advertised development functionality, and this guard must not delete it: the
 *    "Import Demo Catalog (JSON)" transfer is a real feature that works against a real code path.
 *    WCF-13 requires it to stay wired and stays red if a fix erases it to make a leak go away.
 *  - A guard may not pass by finding nothing. WCF-01 fails if the checkout handler cannot be
 *    located, WCF-08 fails if the durable call is gone or the receipt is no longer fed by its
 *    response, and every scan reports what it located.
 *
 * The static half needs no toolchain — customer-web has no test dependency and this suite does not
 * add one. The runtime half uses node's own `fetch` against a server this suite spawns on
 * 127.0.0.1, and sends one GET and two POSTs that carry no session, so it writes nothing anywhere.
 */
process.env.NABIN_TEST_MODE = 'true';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PAGE = path.join(__dirname, '..', 'customer-web', 'src', 'app', 'grocery', 'page.tsx');
const APITS = path.join(__dirname, '..', 'customer-web', 'src', 'lib', 'api.ts');
const SERVER = path.join(__dirname, 'src', 'server.js');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// --- a scanner that knows strings, so a keyword inside prose is not a keyword ----------------
function endOfString(text, i) {
  const q = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== '\n') {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === q) return j + 1;
    j++;
  }
  return j;
}
function endOfTemplate(text, start) {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i;
    if (c === '$' && text[i + 1] === '{') {
      let depth = 1, j = i + 2;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (ch === '"' || ch === "'") { j = endOfString(text, j); continue; }
        if (ch === '`') { j = endOfTemplate(text, j) + 1; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return text.length;
}
// Comments are blanked to spaces (offsets, and therefore line numbers, survive) so the words this
// guard looks for — `setOrder(`, `setTimeout`, `DEMO-` — can only be found where they execute.
function blankComments(text) {
  const out = text.split('');
  const wipe = (a, b) => {
    for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') j++;
      wipe(i, j); i = j; continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const at = text.indexOf('*/', i + 2);
      const end = at < 0 ? text.length : at + 2;
      wipe(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") { i = endOfString(text, i); continue; }
    if (c === '`') { i = endOfTemplate(text, i) + 1; continue; }
    i++;
  }
  return out.join('');
}
function matchPair(text, i, openCh, closeCh) {
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { i = endOfString(text, i); continue; }
    if (c === '`') { i = endOfTemplate(text, i) + 1; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i;
    i++;
  }
  return -1;
}
function bodyFrom(code, fromIdx) {
  const open = code.indexOf('{', fromIdx);
  if (open < 0) return null;
  const close = matchPair(code, open, '{', '}');
  if (close < 0) return null;
  return { start: open, end: close, text: code.slice(open, close + 1) };
}

if (!fs.existsSync(PAGE)) {
  check('WCF-00', false, `${PAGE} does not exist — the screen this guard protects is gone`);
  process.exitCode = 1;
  finish();
  return;
}

const pageSrc = fs.readFileSync(PAGE, 'utf8');
const apiSrc = fs.readFileSync(APITS, 'utf8');
const serverSrc = fs.readFileSync(SERVER, 'utf8');
const P = blankComments(pageSrc);
const S = blankComments(serverSrc);

// `server.js:N` in a message means the line where the durable grocery checkout is REGISTERED, which
// is the citation form the repository's own guard re-anchors.
const ROUTE_REG = "app.post('/api/grocery/checkout/validate'";
const routeAt = () => S.indexOf(ROUTE_REG);
const routeLine = () => (routeAt() < 0 ? 'NOT FOUND' : `server.js:${lineOf(S, routeAt())}`);

// --- locate the checkout handler by what it asks the backend for, not by its name -------------
function handlerFor(callExpr) {
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  let m;
  while ((m = re.exec(P))) {
    const body = bodyFrom(P, m.index + m[0].length);
    if (body && new RegExp('bookingApi\\.' + callExpr).test(P.slice(body.start, body.end))) {
      return { name: m[1], line: lineOf(P, m.index), start: body.start, end: body.end, text: body.text };
    }
  }
  return null;
}
const submitH = handlerFor('checkoutGrocery');
const H = submitH ? submitH.text : '';

check('WCF-01', Boolean(submitH),
  submitH
    ? `the checkout handler is \`${submitH.name}\` at page line ${submitH.line}, located because its body is the one `
      + `that calls bookingApi.checkoutGrocery — every handler-scoped check below reads that block`
    : 'NO handler in the grocery page calls bookingApi.checkoutGrocery: either the durable checkout was deleted '
      + 'or this guard is looking at the wrong screen, and either way the checks below would pass by finding nothing');

// --- the fabrication itself -------------------------------------------------------------------
// An order object built in the browser is the defect. A durable order is one handed back by the
// route, so `setOrder(` may take a response value and may not take a literal.
const mintedOrder = [...P.matchAll(/setOrder\(\s*\{/g)].map((m) => lineOf(P, m.index));
check('WCF-02', mintedOrder.length === 0,
  mintedOrder.length
    ? `${mintedOrder.length} setOrder() call(s) build the order object from a literal, at line(s) ${mintedOrder.join(', ')} — `
      + 'whatever else it contains, that receipt describes an order no checkout route ever wrote'
    : `no setOrder() call builds an order from an object literal${
      submitH ? ` (${(H.match(/setOrder\(/g) || []).length} setOrder call(s) inside the handler, all fed by a value)` : ''}`);

// The invented references are the fingerprints of that path. They are also what a reader would
// search for in the orders table, so their absence is the claim.
const fakeRefs = [...new Set([...P.matchAll(/['"`](DEMO-[A-Za-z0-9_-]*)['"`]/g)].map((m) => m[1]))];
check('WCF-03', fakeRefs.length === 0,
  fakeRefs.length
    ? `the page mints ${fakeRefs.length} order reference(s) out of thin air: ${fakeRefs.join(', ')} — a customer quoting `
      + 'one of these to support finds no row behind it'
    : 'no `DEMO-…` identifier appears in the page, so no reference on its receipt is one the platform cannot look up');

// The gate that decided whether to lie. It is not a feature switch: the value it tests is the
// screen's own default, so it is taken by the first customer who does not edit the field.
const prefixGate = [...P.matchAll(/startsWith\(\s*['"](mcht-demo|demo-)/g)].map((m) => lineOf(P, m.index));
check('WCF-04', prefixGate.length === 0,
  prefixGate.length
    ? `${prefixGate.length} short-circuit(s) on a demo store prefix at line(s) ${prefixGate.join(', ')}`
    : 'no branch keys the checkout path off the shape of the store id, so a customer cannot be routed around the backend '
      + 'by a value sitting in a text box');

// A timer standing in for a network round trip is the same lie on a delay.
const timers = submitH
  ? [...submitH.text.matchAll(/\bsetTimeout\s*\(/g)].map((m) => lineOf(P, submitH.start + m.index))
  : [];
check('WCF-05', Boolean(submitH) && timers.length === 0,
  !submitH
    ? 'NO checkout handler to read (WCF-01 already failed), so the timer scan proved nothing'
    : timers.length === 0
      ? `the checkout handler (${submitH.name}, page line ${submitH.line}) contains no setTimeout, so nothing is `
        + '"placed" on a delay — the only way a confirmation appears is a response from the checkout route'
      : `${timers.length} setTimeout call(s) inside the checkout handler at page line(s) ${timers.join(', ')} — `
        + 'a timer is standing in for a network round trip the browser never made');

// The two prefilled values are what make the fabrication the default rather than an opt-in, and the
// address one is the client half of the rule GRO-ADDR closed on the server.
const storeDefault = /const\s+\[storeId,\s*setStoreId\]\s*=\s*useState\(\s*(['"])((?:[^'"])*)\1/.exec(P);
const addrDefault = /const\s+\[deliveryAddress,\s*setDeliveryAddress\]\s*=\s*useState\(\s*(['"])((?:[^'"])*)\1/.exec(P);
const prefilled = [
  storeDefault && storeDefault[2] ? `storeId defaults to '${storeDefault[2]}' (line ${lineOf(P, storeDefault.index)})` : null,
  addrDefault && addrDefault[2] ? `deliveryAddress defaults to '${addrDefault[2]}' (line ${lineOf(P, addrDefault.index)})` : null,
].filter(Boolean);
check('WCF-06', Boolean(storeDefault) && Boolean(addrDefault) && prefilled.length === 0,
  Boolean(storeDefault) && Boolean(addrDefault)
    ? prefilled.length
      ? `${prefilled.length} invented default(s): ${prefilled.join(';')} — a pre-filled store id is what sends the first `
        + 'customer down the fabricated path, and a pre-filled place is an address no customer typed reaching a durable order'
      : 'both the partner store and the delivery address start empty, so the screen begins with nothing it invented, and '
        + "the server's PLACE_REQUIRED refusal stays reachable for a customer who forgets the place"
    : `could not read both defaults (storeId: ${Boolean(storeDefault)}, deliveryAddress: ${Boolean(addrDefault)})`);

// A blank store id would be answered by the route's own `|| 'mcht_1'`, so the screen must not post
// one. This is the client half of "the store you named is the store that gets the order".
const storeGate = /if\s*\(\s*!\s*storeId\.trim\(\)\s*\)/.test(H);
check('WCF-07', Boolean(submitH) && storeGate,
  storeGate
    ? 'the handler refuses to post a blank partner store, so the checkout route always names the store the customer '
      + 'chose rather than falling through to the route default'
    : `the checkout handler ${submitH ? 'has NO' : '(no handler to read) HAS NO'} store-id gate — an empty field reaches `
      + `a route that answers req.body.merchantId || ... || 'mcht_1' (${routeLine()}), so the order is written against a `
      + 'store nobody named');

// --- the honest path stays honest (positive control) ------------------------------------------
const checkoutCalls = [...P.matchAll(/bookingApi\.checkoutGrocery\s*\(\s*/g)];
const fedFromResponse = /setOrder\(\s*res\.data\.order\s*\)/.test(H);
const gatedOnSuccess = /if\s*\(\s*res\.data\.success\s*\)\s*\{[^{}]*setOrder\(/.test(H);
check('WCF-08', checkoutCalls.length === 1 && fedFromResponse && gatedOnSuccess,
  `${checkoutCalls.length} call(s) to bookingApi.checkoutGrocery, the receipt is fed by `
  + `${fedFromResponse ? '`setOrder(res.data.order)`' : 'NOT the response (FAIL)'}, and `
  + `${gatedOnSuccess ? 'only inside `if (res.data.success)`' : 'NOT gated on the backend\'s own success flag (FAIL)'}`
  + (checkoutCalls.length === 1 && fedFromResponse && gatedOnSuccess
    ? ' — one durable checkout, and an order the customer is shown only because the server wrote it'
    : ' — the durable checkout path has been broken'));

const cartGate = /if\s*\(\s*cart\.length\s*===\s*0\s*\)/.test(H);
const placeGate = /if\s*\(\s*!\s*deliveryAddress\.trim\(\)\s*\)/.test(H);
check('WCF-09', Boolean(submitH) && cartGate && placeGate,
  `pre-submit gates: empty cart ${cartGate ? 'refused locally' : 'NOT refused (FAIL)'}, missing delivery place `
  + `${placeGate ? 'refused locally' : 'NOT refused (FAIL)'} — the screen still asks for a place before it posts one, `
  + 'which is what keeps the server PLACE_REQUIRED refusal a backstop rather than the customer\'s first surprise');

// --- what the receipt is allowed to say -------------------------------------------------------
// A fallback status is a claim made when the backend said nothing. `order.status` is the durable
// `order_state`; `?? 'CONFIRMED'` turns a missing field into a lifecycle assertion.
const statusFallback = [...P.matchAll(/order\.status\s*\?\?\s*['"]([^'"]*)['"]/g)].map((m) => ({ value: m[1], line: lineOf(P, m.index) }));
check('WCF-10', statusFallback.length === 0,
  statusFallback.length
    ? `${statusFallback.length} invented status fallback(s): ${statusFallback.map((s) => `'${s.value}' at line ${s.line}`).join(', ')} — `
      + 'a receipt that supplies its own state will say CONFIRMED about an order the backend never confirmed'
    : 'the badge renders `order.status` with no fallback, so an order whose state did not come back is shown as unknown '
      + 'instead of being declared confirmed');

// The payment line, checked against the route rather than against taste: this checkout writes a
// `checkouts` row and an `orders` row, and touches no wallet. Every name the platform uses to move
// a wallet is listed, so a route that starts debiting here reddens the check that now passes.
const WALLET_MUTATIONS = ['adjust_wallet_atomic', 'adjustWallet', 'updateWalletBalance', 'debitWallet', 'creditWallet'];
const routeBody = (() => {
  const at = routeAt();
  if (at < 0) return null;
  const arrow = S.indexOf('=>', at);
  return arrow < 0 ? null : bodyFrom(S, arrow + 2);
})();
const mutationsFound = routeBody
  ? WALLET_MUTATIONS.filter((n) => routeBody.text.includes(n))
  : ['ROUTE NOT FOUND'];
const paidClaims = [
  /Paid from Wallet/.test(P) ? "'Paid from Wallet'" : null,
  /Debited at checkout/.test(P) ? "'Debited at checkout'" : null,
].filter(Boolean);
check('WCF-11', Boolean(routeBody) && mutationsFound.length === 0 && paidClaims.length === 0,
  !routeBody
    ? 'the /api/grocery/checkout/validate route body could not be located, so the pairing below was NOT measured'
    : `the checkout route body (${routeLine()} → ${routeBody.text.split('\n').length} lines) mutates the wallet `
      + `${mutationsFound.length === 0 ? 'NOWHERE' : `at ${mutationsFound.join(', ')}`}, `
      + `so the screen may not claim a completed payment: ${
        paidClaims.length ? `${paidClaims.length} completed-payment claim(s) still on the page — ${paidClaims.join(', ')}` : 'no completed-payment wording found'}`);

// The catalogue the customer browses decides what "orderable" means. This screen reads products
// from this browser's stored copy, so a banner that promises the merchant portal's live catalogue
// is a claim about a fetch the page never makes.
const fetchesProducts = /grocery\/products/.test(P) || /grocery\/products/.test(apiSrc);
const liveClaims = [
  /Live Catalog Sync/.test(P) ? "'Live Catalog Sync'" : null,
  /instantly browseable and orderable/.test(P) ? "'instantly browseable and orderable'" : null,
].filter(Boolean);
check('WCF-12', !liveClaims.length || fetchesProducts,
  `the page ${fetchesProducts ? 'does' : 'does NOT'} read /api/grocery/products`
  + (liveClaims.length
    ? `, and ${liveClaims.length} live-catalogue claim(s) sit on it: ${liveClaims.join(', ')} — the products come from the `
      + 'imported/stored demo catalog, so the wording promises a sync no request performs'
    : ' and carries no live-catalogue claim; the stored-catalog wording matches what the code actually does'));

// --- the advertised development feature stays ------------------------------------------------
// P11 requirement 4 in this screen's terms: the Demo Catalog transfer is a real, labelled feature.
// A fix that erases it to clean up the checkout destroys working development functionality, and the
// guard refuses that.
const importWired = /importDemoCatalogPayload\s*\(/.test(P);
const importButton = (() => {
  const at = P.indexOf('Import Demo Catalog');
  if (at < 0) return null;
  const start = P.lastIndexOf('<button', at);
  const endRel = P.indexOf('</button>', at);
  if (start < 0 || endRel < 0) return null;
  const el = P.slice(start, endRel);
  return { line: lineOf(P, start), typeButton: /type="button"/.test(el), saysDemo: /Demo/.test(el) };
})();
check('WCF-13', importWired && Boolean(importButton) && importButton.typeButton && importButton.saysDemo,
  `demo-catalog import ${importWired ? 'still wired' : 'NOT wired (FAIL)'} to `
  + (importButton
    ? `a button at line ${importButton.line} that is ${importButton.typeButton ? 'type="button"' : 'NOT type="button" (FAIL)'} `
      + `and ${importButton.saysDemo ? 'labelled Demo' : 'NOT labelled Demo (FAIL)'}`
    : 'no locatable button (FAIL)')
  + (importWired && importButton && importButton.typeButton && importButton.saysDemo
    ? ' — the advertised development path stays, clearly named, so a customer is never shown a demo by accident'
    : ''));

// --- runtime: could the fabricated payload ever have become a real order? ----------------------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function post(baseUrl, urlPath, token, payload) {
  const res = await fetch(baseUrl + urlPath, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* non-JSON answer is still a refusal if it is 4xx */ }
  return { status: res.status, json, code: json && json.code, hasOrder: Boolean(json && json.order), text };
}

// The payload the screen used to send down its fabricated path: the invented store, the invented
// Delhi place, and one item name from the bundled demo catalog.
const FABRICATED_PAYLOAD = {
  merchantId: 'mcht-demo-grocery-1',
  paymentMethod: 'WALLET',
  deliveryAddress: 'Flat 402, Civil Lines, Delhi',
  items: [{ name: 'Aashirvaad Whole Wheat Atta (5 kg)', quantity: 1 }],
};

async function runRuntime() {
  const net = require('net');
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname),
    windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port) }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stderr = [];
  proc.stderr.on('data', (d) => stderr.push(String(d)));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(250);
      try { ready = (await fetch(`${baseUrl}/api/health`)).status === 200; } catch (e) { /* not up yet */ }
    }
    check('WCF-14', ready,
      ready
        ? `the backend this screen talks to booted on 127.0.0.1:${port} — the two POST probes below are answered by the `
          + 'route the fabricated order was avoiding, not by a stub'
        : `the backend never came up, so the runtime claims were NOT measured: ${stderr.join('').slice(-240)}`);
    if (!ready) return;

    // (a) No session, the invented payload. Whatever gate answers it, the answer is a refusal and
    //     carries no order — so the receipt the old code painted had no durable record behind it.
    const anon = await post(baseUrl, '/api/grocery/checkout/validate', null, FABRICATED_PAYLOAD);
    check('WCF-15', anon.status >= 400 && anon.status < 500 && !anon.hasOrder,
      `the screen's old payload, posted with no session, is refused: ${anon.status} `
      + `${anon.code || `(body: ${anon.text.slice(0, 80)})`} with ${anon.hasOrder ? 'AN ORDER IN THE BODY (FAIL)' : 'no order returned'}`);

    // (b) The same payload with the client-minted demo token from the login screen's Demo Mode. A
    //     demo session cannot order groceries, which is why the branch existed — and the reason it
    //     is safe to delete is that the customer was never getting an order, only the shape of one.
    const demo = await post(baseUrl, '/api/grocery/checkout/validate', 'demo-customer-token', FABRICATED_PAYLOAD);
    check('WCF-16', demo.status >= 400 && demo.status < 500 && !demo.hasOrder,
      `the same payload with the client-minted \`demo-customer-token\` is refused the same way: ${demo.status} `
      + `${demo.code || `(body: ${demo.text.slice(0, 80)})`}, ${demo.hasOrder ? 'AN ORDER IN THE BODY (FAIL)' : 'no order returned'} `
      + '— so the deleted branch could never have produced a real order even by accident');
  } finally {
    proc.kill();
  }
}

runRuntime().then(finish).catch((err) => {
  check('WCF-14', false, `the runtime half threw before it could measure: ${String(err && err.message)}`);
  finish();
});

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 WEB CHECKOUT FABRICATION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log(`failed: ${failed.map((f) => f.id).join(', ')}`);
  console.log('='.repeat(72));
  process.exitCode = failed.length ? 1 : 0;
}
