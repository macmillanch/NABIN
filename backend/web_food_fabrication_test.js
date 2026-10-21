/*
 * FOOD-WEB: the customer-food screen must show an order the platform actually wrote, and must show it
 * when it did.
 *
 * This file was written for four defects in `customer-web/src/app/food/page.tsx`, three of which are on
 * the path a real customer on a real session takes:
 *
 *  1. THE SILENT LOSS. `POST /api/customer/book-food` answers `{ success, duplicate, order, deliveryJob }`
 *     (src/server.js:5154, read out of the route's own `res.json`). The page read `res.data.job`, a key
 *     that route has never sent, so `setOrder(undefined)` left the receipt block unrendered while
 *     `setCart([])` and `setMenu([])` had already run and `idemRef.current` had been replaced with a fresh
 *     key. A food order that WAS durable, WAS server-priced and DID dispatch a rider came back as nothing
 *     on screen — and the only recovery the customer has (submit again) now carries a different
 *     idempotency key, so the second attempt is a second real order. This is the more expensive of the
 *     four: the fabricated branch below invents an order, this one loses one.
 *  2. THE FABRICATION. `if (active.id.startsWith("demo-"))` finished the order in the browser —
 *     `{ id: 'DEMO-ORD-8812', orderNumber: 'DEMO-FOOD-8812', status: 'PLACED', totalAmount: estimate }`,
 *     with `estimate` from this page's own arithmetic, under a receipt line that says "Total charged
 *     (server priced)". No request was made, so no `orders` row, no merchant notification, no rider.
 *  3. THE FAIL-OPEN THAT MAKES #2 REACHABLE WITHOUT ANY DEMO BUTTON. The discovery `catch` answers a
 *     backend that could not be reached by replacing the restaurant list with two invented Kolkata
 *     stores (`demo-rest-01` "The Royal Biryani House", `demo-rest-02` "Tandoori Nights & Rolls").
 *     `setListState("error")` is never called anywhere in the file, so the error-and-Retry branch the
 *     page renders at `listState === "error"` is dead code — an outage cannot be reported, only papered
 *     over. A customer on a REAL session, whose backend is simply down, is handed an invented store, and
 *     tapping it puts them in the fabricated branch. That is the P11 fail-open shape in a new place.
 *  4. THE INVENTED LIFECYCLE AND THE INVENTED PAYMENT. The badge renders `order.status ?? "RECEIVED"`, so
 *     a missing state still asserts a lifecycle; and the route body (server.js:4778-5164) contains ZERO
 *     wallet mutations — measured, not assumed, by scanning every name the platform uses to move a wallet
 *     — so the receipt may not say an amount was charged.
 *
 * Two rules constrain the guard, and they pull against each other:
 *  - The screen has advertised development functionality that a fix must not erase. "Demo Mode" and
 *    "Instant Demo Sign-In" are real labelled buttons (customer-web/src/app/login/page.tsx:117,169) that
 *    mint the `demo-customer-token` persona, and the "Import Demo Catalog (JSON)" transfer is a working
 *    feature. WF-17 and WF-18 stay red if a fix deletes either to make a leak go away.
 *  - A guard may not pass by finding nothing. WF-01 fails if the submit handler cannot be located, WF-02
 *    and WF-03 derive their expectations from the route's own response object rather than a constant in
 *    this file, and every scan reports what it found.
 *
 * The static half adds no toolchain — customer-web has no test dependency and this suite does not add
 * one. The runtime half boots THIS tree's backend on 127.0.0.1 through the loopback target guard, and
 * sends only POSTs that carry no valid session, so it writes no order anywhere. The durable placement
 * path is deliberately NOT exercised: it would write a real `orders` row, a checkout leg and a rider
 * dispatch into the shared store, and the chain's zero-order-residue property (#314) is worth more than
 * a runtime convenience here. Where the fix's response-key claim could be proven by a write is noted as
 * not-measured, and WF-02/WF-03 carry it by reading both sides of the contract from source instead.
 */
'use strict';

process.env.NABIN_TEST_MODE = 'true';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, findFreePort } = require('./scripts/spawned_server');

// Booting src/server.js connects it to whatever store its environment declares, so the same refusal the
// writing suites use applies here even though this suite intends to write nothing.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'web_food_fabrication_test' });

const PAGE = path.join(__dirname, '..', 'customer-web', 'src', 'app', 'food', 'page.tsx');
const SERVER = path.join(__dirname, 'src', 'server.js');
const MIG018 = path.join(__dirname, '..', 'supabase', 'migrations', '018_order_state_lines_and_checkout_linkage.sql');

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
// Comments are blanked to spaces (offsets, and therefore line numbers, survive) so the words this guard
// looks for — `setOrder(`, `DEMO-`, `charged`, `catch` — can only be found where they execute.
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
// Top-level property names of an object literal, including ES6 shorthand (`deliveryJob`).
function topLevelKeys(objText) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < objText.length; i++) {
    const c = objText[i];
    if (c === '"' || c === "'") { const e = endOfString(objText, i); if (depth >= 1) cur += objText.slice(i, e); i = e - 1; continue; }
    if (c === '`') { const e = endOfTemplate(objText, i); if (depth >= 1) cur += objText.slice(i, e + 1); i = e; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; if (depth > 1) cur += c; continue; }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth < 1) { if (cur.trim()) parts.push(cur); cur = ''; continue; }
      cur += c; continue;
    }
    if (c === ',' && depth === 1) { parts.push(cur); cur = ''; continue; }
    if (depth >= 1) cur += c;
  }
  const keys = [];
  for (const raw of parts) {
    const t = raw.trim();
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(t);
    if (m) { keys.push(m[1]); continue; }
    if (/^[A-Za-z_$][\w$]*$/.test(t)) keys.push(t);
  }
  return [...new Set(keys)];
}

if (!fs.existsSync(PAGE)) {
  check('WF-00', false, `${PAGE} does not exist — the screen this guard protects is gone`);
  process.exitCode = 1;
  finish();
  return;
}

const pageSrc = fs.readFileSync(PAGE, 'utf8');
const serverSrc = fs.readFileSync(SERVER, 'utf8');
const P = blankComments(pageSrc);
const S = blankComments(serverSrc);

// `server.js:N` below means the line where the durable food booking is REGISTERED — the citation form the
// repository's own guard (chain link 53) re-anchors, never a hand-written number.
const ROUTE_REG = "app.post('/api/customer/book-food'";
const routeAt = () => S.indexOf(ROUTE_REG);
const routeLine = () => (routeAt() < 0 ? 'NOT FOUND' : `server.js:${lineOf(S, routeAt())}`);

const routeBody = (() => {
  const at = routeAt();
  if (at < 0) return null;
  const arrow = S.indexOf('=>', at);
  return arrow < 0 ? null : bodyFrom(S, arrow + 2);
})();

// --- the route's own success contract, read out of the route ----------------------------------
const successObjects = [];
if (routeBody) {
  const re = /\bres\.json\(\s*\{/g;
  let m;
  while ((m = re.exec(routeBody.text))) {
    const obj = bodyFrom(routeBody.text, m.index + m[0].length - 1);
    if (obj && /\bsuccess:\s*true\b/.test(obj.text)) {
      successObjects.push({ line: lineOf(S, routeBody.start + m.index), text: obj.text, keys: topLevelKeys(obj.text) });
    }
  }
}
const routeKeys = [...new Set(successObjects.flatMap((o) => o.keys))];

// The page reads one of these fields as "the order". Locate the payload variable the route binds to the
// `order` field so the receipt's own field reads can be checked against what the route declares.
const orderPayloadObj = (() => {
  const withOrder = successObjects.find((o) => /(^|[{,\s])order\s*:/.test(o.text));
  if (!withOrder) return null;
  const varName = /(?:^|[{,\s])order\s*:\s*([A-Za-z_$][\w$]*)/.exec(withOrder.text);
  if (!varName || varName[1] === 'order') return null;
  const decl = new RegExp(`const ${varName[1]}\\s*=\\s*\\{`).exec(routeBody ? routeBody.text : '');
  if (!decl) return null;
  const obj = bodyFrom(routeBody.text, decl.index + decl[0].length - 1);
  return obj ? { varName: varName[1], keys: topLevelKeys(obj.text) } : null;
})();

// --- locate the submit handler by what it asks the backend for, not by its name ----------------
function handlerFor(callExpr) {
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  let m;
  while ((m = re.exec(P))) {
    // A concise-body arrow (`=> expr`) has no block of its own; scanning on for the next `{` would
    // attribute the following function's body to this name.
    const at = P.slice(m.index + m[0].length).search(/\S/);
    if (at < 0 || P[m.index + m[0].length + at] !== '{') continue;
    const body = bodyFrom(P, m.index + m[0].length + at);
    if (body && new RegExp('bookingApi\\.' + callExpr).test(body.text)) {
      return { name: m[1], line: lineOf(P, m.index), start: body.start, end: body.end, text: body.text };
    }
  }
  return null;
}
const submitH = handlerFor('bookFood');

check('WF-01', Boolean(submitH) && Boolean(routeBody) && successObjects.length > 0,
  `submit handler: ${submitH ? `\`${submitH.name}\` at page line ${submitH.line}, located because its body is the one that `
    + 'calls bookingApi.bookFood' : 'NOT FOUND (FAIL)'}; booking route: ${routeBody ? `${routeLine()} → ${routeBody.text.split('\n').length} lines` : 'NOT FOUND (FAIL)'}; `
  + `success responses in it: ${successObjects.length ? successObjects.map((o) => `line ${o.line} [${o.keys.join(', ')}]`).join('; ') : 'NONE (FAIL)'} — `
  + 'every handler-scoped and contract-scoped check below reads those blocks, so a check cannot pass by finding nothing');

// --- 1. the response key the page reads must be one the route sends ----------------------------
const setOrderExprs = submitH
  ? [...submitH.text.matchAll(/setOrder\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g)].map((m) => m[1])
  : [];
const readKeys = [...new Set(setOrderExprs.filter((e) => /^res\.data\./.test(e)).map((e) => e.split('.').pop()))];
const keyMatch = readKeys.length > 0 && routeKeys.length > 0 && readKeys.every((k) => routeKeys.includes(k));
check('WF-02', keyMatch,
  `the page reads ${readKeys.length ? readKeys.map((k) => `res.data.${k}`).join(', ') : 'NO res.data.* value (FAIL)'} into the `
  + `receipt, while the booking route's success object declares [${routeKeys.join(', ')}] (${routeLine()} → `
  + `${successObjects.map((o) => `server.js:${o.line}`).join(', ')}). `
  + (keyMatch
    ? 'Every key the page reads is a key the route sends, so a placed order reaches the receipt'
    : ' — a key the route never sends is undefined, and `setOrder(undefined)` renders no receipt at all while the '
      + 'handler has already emptied the cart and rotated the idempotency key, so the customer\'s only retry path '
      + 'places a SECOND real order'));

const receiptFields = [...new Set([...P.matchAll(/\border\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
const missingFields = orderPayloadObj ? receiptFields.filter((f) => !orderPayloadObj.keys.includes(f)) : ['ROUTE PAYLOAD NOT FOUND'];
check('WF-03', Boolean(orderPayloadObj) && missingFields.length === 0 && receiptFields.length > 0,
  `the receipt reads [${receiptFields.join(', ')}] off the order value; the route's ${orderPayloadObj ? orderPayloadObj.varName : 'order payload'} declares `
  + `${orderPayloadObj ? `${orderPayloadObj.keys.length} fields` : 'NOT FOUND (FAIL)'}. `
  + (orderPayloadObj && missingFields.length === 0
    ? 'Every field the receipt renders is one the route declares, so no row of it is a field name the backend abandoned'
    : ` not declared by the route: [${missingFields.join(', ')}]`));

// --- the fabrication itself -------------------------------------------------------------------
const mintedOrder = [...P.matchAll(/setOrder\(\s*\{/g)].map((m) => lineOf(P, m.index));
check('WF-04', mintedOrder.length === 0,
  mintedOrder.length
    ? `${mintedOrder.length} setOrder() call(s) build the order from an object literal, at page line(s) ${mintedOrder.join(', ')} — `
      + 'that receipt describes an order no booking route ever wrote'
    : `no setOrder() call takes an object literal${submitH ? ` (${(submitH.text.match(/setOrder\(/g) || []).length} setOrder call(s) inside the handler, all fed by a value)` : ''}`);

const fakeRefs = [...new Set([...P.matchAll(/['"`](DEMO-[A-Za-z0-9_-]*)['"`]/g)].map((m) => m[1]))];
check('WF-05', fakeRefs.length === 0,
  fakeRefs.length
    ? `the page mints ${fakeRefs.length} order reference(s) out of thin air: ${fakeRefs.join(', ')} — a customer quoting one of `
      + 'these to support finds no row behind it'
    : 'no `DEMO-…` identifier appears in the page, so no reference on its receipt is one the platform cannot look up');

// The gate that decided whether to lie. Browsing the declared demo persona's catalog is a separate
// thing (WF-18 requires it to survive); what must not exist is a prefix that decides whether an ORDER
// exists — that is the difference between a demo store and no store.
const prefixGates = [...P.matchAll(/([A-Za-z_$][\w$.]*)\.startsWith\(\s*['"](mcht-demo|demo-)/g)]
  .map((m) => ({ expr: m[1], value: m[2], line: lineOf(P, m.index), inHandler: m.index >= submitH.start && m.index <= submitH.end }));
const orderGates = prefixGates.filter((g) => g.inHandler);
check('WF-06', orderGates.length === 0 && prefixGates.length > 0,
  prefixGates.length
    ? `${prefixGates.length} prefix gate(s) found: ${prefixGates.map((g) => `${g.expr}.startsWith("${g.value}") at line ${g.line}${g.inHandler ? ' [INSIDE the submit handler]' : ' [menu browsing, outside]'}`).join('; ')}. `
      + (orderGates.length
        ? 'A gate on the ORDER path means the shape of a store id decides whether the customer is told the truth'
        : 'None keys the order path, so no store id can route a customer around the backend')
    : 'NO `demo-` prefix gate exists anywhere — the declared demo persona has been deleted rather than confined, '
      + 'and this guard cannot tell a correct fix from one that erased a working feature');

const timers = submitH ? [...submitH.text.matchAll(/\bsetTimeout\s*\(/g)].map((m) => lineOf(P, submitH.start + m.index)) : [];
check('WF-07', Boolean(submitH) && timers.length === 0,
  !submitH
    ? 'NO submit handler to read (WF-01 already failed), so the timer scan proved nothing'
    : timers.length === 0
      ? `the submit handler (${submitH.name}, page line ${submitH.line}) contains no setTimeout, so nothing is "placed" on a `
        + 'delay — the only way a confirmation can appear is a response from the booking route'
      : `${timers.length} setTimeout call(s) inside the submit handler at page line(s) ${timers.join(', ')} — a timer is `
        + 'standing in for a network round trip the browser never made');

// --- invented defaults: what makes a bad path the first path ----------------------------------
const addrDefault = /const\s+\[deliveryAddress,\s*setDeliveryAddress\]\s*=\s*useState\(\s*(['"])((?:[^'"])*)\1/.exec(P);
const activeDefault = /const\s+\[active,\s*setActive\]\s*=\s*useState(?:<[^>]*>)?\s*\(\s*(null)/.exec(P);
const inventedDefaults = [
  addrDefault && addrDefault[2] ? `deliveryAddress defaults to '${addrDefault[2]}' (line ${lineOf(P, addrDefault.index)})` : null,
  !activeDefault ? 'a restaurant is pre-selected, so the screen opens inside someone else\'s order' : null,
].filter(Boolean);
check('WF-08', Boolean(addrDefault) && inventedDefaults.length === 0,
  `defaults read: deliveryAddress ${addrDefault ? `useState('${addrDefault[2]}') at line ${lineOf(P, addrDefault.index)}` : 'NOT FOUND (FAIL)'}, `
  + `active ${activeDefault ? 'useState(null)' : 'useState(<non-null or unmatched>)'}. `
  + (addrDefault && inventedDefaults.length === 0
    ? 'Nothing on this screen begins filled in — the place is one the customer typed and the store one they tapped'
    : inventedDefaults.join(';')));

// A key replaced before the order landed is a double order. It may only be replaced where an order
// actually arrived, so the retry of a timed-out submit dedupes instead of booking twice.
const successBlock = (() => {
  if (!submitH) return null;
  const m = /if\s*\(\s*res\.data\.success\s*\)\s*\{/.exec(submitH.text);
  if (!m) return null;
  const open = submitH.start + m.index + m[0].length - 1;
  const close = matchPair(P, open, '{', '}');
  return close < 0 ? null : { start: open, end: close };
})();
const rotations = [...P.matchAll(/idemRef\.current\s*=/g)].map((m) => ({ line: lineOf(P, m.index), inSuccess: Boolean(successBlock) && m.index >= successBlock.start && m.index <= successBlock.end }));
const inHandlerRotations = rotations.filter((r) => submitH && r.line >= submitH.line && r.line <= lineOf(P, submitH.end));
check('WF-09', Boolean(submitH) && Boolean(successBlock) && inHandlerRotations.length > 0 && inHandlerRotations.every((r) => r.inSuccess),
  `idempotency key rotations found at page line(s) [${rotations.map((r) => `${r.line}${r.inSuccess ? ' (inside the success branch)' : ' (NOT inside it)'}`).join(', ') || 'none'}]; `
  + `the success block is ${successBlock ? `lines ${lineOf(P, successBlock.start)}–${lineOf(P, successBlock.end)}` : 'NOT LOCATED (FAIL)'}. `
  + (Boolean(successBlock) && inHandlerRotations.length > 0 && inHandlerRotations.every((r) => r.inSuccess)
    ? 'The key is replaced only on a branch where the route confirmed an order, so a timed-out submit retried by the '
      + 'customer is deduped by the server rather than becoming a second charge'
    : 'a rotation outside the confirmed-order branch means a failed or unanswered submit discards the key that would '
      + 'have deduped the retry'));

// --- 3. the outage fail-open ------------------------------------------------------------------
function callbackBody(name) {
  const sig = `const ${name} = useCallback(`;
  const at = P.indexOf(sig);
  if (at < 0) return null;
  const parenOpen = P.indexOf('(', at + sig.length - 1);
  const parenClose = matchPair(P, parenOpen, '(', ')');
  if (parenClose < 0) return null;
  const inner = P.slice(parenOpen + 1, parenClose);
  const open = inner.indexOf('{');
  if (open < 0) return null;
  const close = matchPair(inner, open, '{', '}');
  if (close < 0) return null;
  return { start: parenOpen + 1 + open, end: parenOpen + 1 + close, text: inner.slice(open, close + 1) };
}
function catchBlocks(body) {
  const out = [];
  const re = /\bcatch\b/g;
  let m;
  while ((m = re.exec(body.text))) {
    const braceAt = body.text.indexOf('{', m.index);
    if (braceAt < 0) continue;
    const close = matchPair(body.text, braceAt, '{', '}');
    if (close < 0) continue;
    out.push({ start: body.start + braceAt, end: body.start + close, text: body.text.slice(braceAt, close + 1) });
  }
  return out;
}
const discoverCb = callbackBody('loadRestaurants');
const discoverCatches = discoverCb ? catchBlocks(discoverCb) : [];
const fabricating = discoverCatches
  .map((c) => ({ line: lineOf(P, c.start), mints: [...c.text.matchAll(/setRestaurants\(\s*\[/g)].length, reportsError: /setListState\(\s*['"]error['"]/.test(c.text) }))
  .filter((c) => c.mints > 0 && !c.reportsError);
check('WF-10', Boolean(discoverCb) && discoverCatches.length > 0 && fabricating.length === 0,
  !discoverCb
    ? 'NO `loadRestaurants` useCallback to read (FAIL) — the outage path cannot be examined, so this check proves nothing'
    : `${discoverCatches.length} catch block(s) in the discovery callback at page line(s) ${discoverCatches.map((c) => lineOf(P, c.start)).join(', ')}: `
      + `state ${fabricating.length ? `substitutes ${fabricating.map((f) => `${f.mints} invented restaurant list(s) at line ${f.line}`).join(', ')}` : 'reports the failure instead of replacing the list'}. `
      + (Boolean(discoverCatches.length) && fabricating.length === 0
        ? 'a store that cannot be reached is reported as unreachable, which is what keeps the invented demo stores off '
          + 'the screen of a customer on a real session'
        : 'an unreachable backend answered with fabricated merchants is the P11 fail-open in the discovery path, and it '
          + 'is how a real session reaches a store id the order path then lies about'));

const errorSetter = [...P.matchAll(/setListState\(\s*['"]error['"]\s*\)/g)].map((m) => lineOf(P, m.index));
const errorBranch = /listState === ['"]error['"]/.test(P);
check('WF-11', errorSetter.length > 0 && errorBranch,
  `setListState("error") appears ${errorSetter.length} time(s)${errorSetter.length ? ` at page line(s) ${errorSetter.join(', ')}` : ''}, and the `
  + `rendered error branch (${errorBranch ? 'present' : 'ABSENT (FAIL)'}) reads \`listState === "error"\`. `
  + (errorSetter.length > 0 && errorBranch
    ? 'The Retry-and-message branch this screen already ships is reachable, so a failed read can be shown'
    : ' — an error branch nothing can set is dead code: the screen has no way to report an outage even though it renders one'));

// --- what the receipt is allowed to say -------------------------------------------------------
const statusFallback = [...P.matchAll(/order\.status\s*(?:\?\?|\|\|)\s*['"]([^'"]*)['"]/g)]
  .map((m) => ({ value: m[1], line: lineOf(P, m.index) }));
check('WF-12', statusFallback.length === 0,
  statusFallback.length
    ? `${statusFallback.length} invented status fallback(s): ${statusFallback.map((s) => `'${s.value}' at line ${s.line}`).join(', ')} — a `
      + 'receipt that supplies its own state will declare a lifecycle the booking route never returned'
    : 'the badge renders the order\'s own state with no fallback, so a state that did not come back is shown as unknown');

// The money wording, checked against the route rather than against taste: this booking writes an `orders`
// row and dispatches a rider, and moves no wallet at all, so "charged" records a payment that happens here
// in no code path. Every name the platform uses to move a wallet is listed, so a route that starts debiting
// at placement reddens the check that now passes.
const WALLET_MUTATIONS = ['adjust_wallet_atomic', 'adjustWallet', 'updateWalletBalance', 'debitWallet', 'creditWallet'];
const mutationsFound = routeBody ? WALLET_MUTATIONS.filter((n) => routeBody.text.includes(n)) : ['ROUTE NOT FOUND'];
const paidClaims = [
  /Total charged/.test(P) ? "'Total charged'" : null,
  /Paid from Wallet/.test(P) ? "'Paid from Wallet'" : null,
  /Debited at checkout/.test(P) ? "'Debited at checkout'" : null,
  /Payment (Successful|Complete)/.test(P) ? "'Payment Successful/Complete'" : null,
].filter(Boolean);
check('WF-13', Boolean(routeBody) && mutationsFound.length === 0 && paidClaims.length === 0,
  !routeBody
    ? 'the /api/customer/book-food route body could not be located, so the pairing below was NOT measured'
    : `the booking route body (${routeLine()} → ${routeBody.text.split('\n').length} lines) mutates the wallet `
      + `${mutationsFound.length === 0 ? 'NOWHERE' : `at ${mutationsFound.join(', ')}`}, so the screen may not claim a `
      + `completed payment: ${paidClaims.length ? `${paidClaims.length} completed-payment claim(s) still on the page — ${paidClaims.join(', ')}` : 'no completed-payment wording found'}`);

const migSrc = fs.existsSync(MIG018) ? fs.readFileSync(MIG018, 'utf8') : '';
const snapshotAt = migSrc.search(/product_name_snapshot\s+VARCHAR/);
check('WF-14', snapshotAt >= 0,
  snapshotAt >= 0
    ? `the receipt's line rows read \`product_name_snapshot\`, which migration 018 declares at line ${lineOf(migSrc, snapshotAt)} as a `
      + 'VARCHAR NOT NULL column on the durable order lines — the snapshot the customer sees is the one written with the order'
    : '`product_name_snapshot` is not declared in 018_order_state_lines_and_checkout_linkage.sql, so the receipt renders a '
      + 'column name the schema does not have');

// --- the honest path stays honest (positive controls) -----------------------------------------
const bookCalls = [...P.matchAll(/bookingApi\.bookFood\s*\(\s*/g)];
const setOrderInSuccess = Boolean(successBlock) && /setOrder\(/.test(P.slice(successBlock.start, successBlock.end));
const cartClearedInSuccess = Boolean(successBlock) && /setCart\(\s*\[\s*\]\s*\)/.test(P.slice(successBlock.start, successBlock.end));
check('WF-15', bookCalls.length === 1 && Boolean(successBlock) && setOrderInSuccess && cartClearedInSuccess,
  `${bookCalls.length} call(s) to bookingApi.bookFood; inside the success branch the receipt is fed by `
  + `${setOrderInSuccess ? 'a response value' : 'NOTHING (FAIL)'} and the cart is cleared by `
  + `${cartClearedInSuccess ? '`setCart([])`' : 'NOTHING (FAIL)'}. `
  + (bookCalls.length === 1 && setOrderInSuccess && cartClearedInSuccess
    ? 'One durable booking, and the cart only empties on the branch where the server wrote the order — so a refused or '
      + 'unreachable submit leaves the customer their cart instead of eating it'
    : ' — the durable booking path has been broken'));

const activeGate = /if\s*\(\s*!\s*active\s*\)/.test(P);
const cartGate = submitH ? /if\s*\(\s*cart\.length\s*===\s*0\s*\)/.test(submitH.text) : false;
const placeGate = submitH ? /if\s*\(\s*!\s*deliveryAddress\.trim\(\)\s*\)/.test(submitH.text) : false;
check('WF-16', activeGate && cartGate && placeGate,
  `pre-submit gates: no store chosen ${activeGate ? 'refused locally' : 'NOT refused (FAIL)'}, empty cart `
  + `${cartGate ? 'refused locally' : 'NOT refused (FAIL)'}, missing delivery place ${placeGate ? 'refused locally' : 'NOT refused (FAIL)'}. `
  + (activeGate && cartGate && placeGate
    ? 'The screen still asks for a store and a place before it posts one, which keeps the route\'s own MERCHANT_REQUIRED '
      + 'and PLACE_REQUIRED refusals a backstop rather than the customer\'s first surprise'
    : ''));

// --- the advertised development features stay -------------------------------------------------
// P11 requirement 4 in this screen's terms. A fix that erases either to clean up the order path destroys
// working development functionality, and the guard refuses that.
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
check('WF-17', importWired && Boolean(importButton) && importButton.typeButton && importButton.saysDemo,
  `demo-catalog import ${importWired ? 'still wired' : 'NOT wired (FAIL)'} to `
  + (importButton
    ? `a button at line ${importButton.line} that is ${importButton.typeButton ? 'type="button"' : 'NOT type="button" (FAIL)'} `
      + `and ${importButton.saysDemo ? 'labelled Demo' : 'NOT labelled Demo (FAIL)'}`
    : 'no locatable button (FAIL)')
  + (importWired && importButton && importButton.typeButton && importButton.saysDemo
    ? ' — the advertised transfer stays, clearly named'
    : ''));

const menuGates = prefixGates.filter((g) => !g.inHandler);
const demoMenuDisclosed = /setMenuDegraded\(\s*true\s*\)/.test(P);
const demoStoreDisclosed = /setListDegraded\(\s*true\s*\)/.test(P);
check('WF-18', menuGates.length > 0 && demoMenuDisclosed && demoStoreDisclosed,
  `${menuGates.length} demo-prefix gate(s) left on the browsing path${menuGates.length ? ` (page line(s) ${menuGates.map((g) => g.line).join(', ')})` : ' (FAIL — the persona was deleted, not confined)'}, `
  + `stored-catalog menus are flagged ${demoMenuDisclosed ? 'degraded' : 'NOT flagged (FAIL)'}, and substituted store lists `
  + `are flagged ${demoStoreDisclosed ? 'degraded' : 'NOT flagged (FAIL)'}. `
  + (menuGates.length > 0 && demoMenuDisclosed && demoStoreDisclosed
    ? ' — the declared demo persona can still browse, and every sample it shows is labelled as one'
    : ''));

// --- runtime: could the fabricated completion ever have become a real order? -------------------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function post(baseUrl, urlPath, token, payload) {
  const res = await fetch(baseUrl + urlPath, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* a non-JSON answer is still a refusal if it is 4xx */ }
  const orderish = Boolean(json && (json.order || json.job));
  return { status: res.status, json, code: json && json.code, orderish, text };
}

// What the deleted browser-side completion stood in for: the invented store, a place from the field's own
// placeholder, and product ids that exist only in this browser's stored catalog.
const FABRICATED_PAYLOAD = {
  restaurantId: 'demo-rest-01',
  deliveryAddress: 'North Campus Girls Hostel, Delhi',
  items: [{ productId: 'demo-dish-01', quantity: 1 }],
};
// A store that really is bookable, to show the refusal below is the session and not the store's shape.
const REAL_STORE = '00000000-0000-0000-0000-000000000201';

async function runRuntime() {
  const port = await findFreePort();
  const proc = trackServer(spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname),
    windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0' }),
    stdio: ['ignore', 'ignore', 'pipe'],
  }));
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
    check('WF-19', ready,
      ready
        ? `the backend this screen talks to booted on 127.0.0.1:${port} against the loopback store this run declared `
          + `(${PG_TARGET.host}:${PG_TARGET.port}/${PG_TARGET.database}, from ${PG_TARGET.source}) — the three POST probes `
          + 'below are answered by the route the fabricated order was avoiding, not by a stub'
        : `the backend never came up, so the runtime claims were NOT measured: ${stderr.join('').slice(-240)}`);
    if (!ready) return;

    const anon = await post(baseUrl, '/api/customer/book-food', null, FABRICATED_PAYLOAD);
    check('WF-20', anon.status >= 400 && anon.status < 500 && !anon.orderish,
      `the screen's invented payload, posted with no session: ${anon.status} ${anon.code || `(body: ${anon.text.slice(0, 80)})`}, `
      + `${anon.orderish ? 'AN ORDER IN THE BODY (FAIL)' : 'no order and no job returned'}`);

    const demo = await post(baseUrl, '/api/customer/book-food', 'demo-customer-token', FABRICATED_PAYLOAD);
    check('WF-21', demo.status >= 400 && demo.status < 500 && !demo.orderish,
      `the same payload with the client-minted \`demo-customer-token\`: ${demo.status} ${demo.code || `(body: ${demo.text.slice(0, 80)})`}, `
      + `${demo.orderish ? 'AN ORDER IN THE BODY (FAIL)' : 'no order and no job returned'} — so the deleted branch could never `
      + 'have produced a real order even by accident, which is why deleting it loses the customer nothing but a lie');

    const real = await post(baseUrl, '/api/customer/book-food', 'demo-customer-token',
      Object.assign({}, FABRICATED_PAYLOAD, { restaurantId: REAL_STORE }));
    check('WF-22', real.status >= 400 && real.status < 500 && !real.orderish,
      `the demo token aimed at the seeded bookable restaurant ${REAL_STORE}: ${real.status} ${real.code || `(body: ${real.text.slice(0, 80)})`}, `
      + `${real.orderish ? 'AN ORDER IN THE BODY (FAIL)' : 'no order and no job returned'} — the refusal is the session, not `
      + 'the store id, so no demo bearer can place a food order by naming a real store');
  } finally {
    proc.kill();
  }
}

runRuntime().then(finish).catch((err) => {
  check('WF-19', false, `the runtime half threw before it could measure: ${String(err && err.message)}`);
  finish();
});

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 WEB FOOD FABRICATION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log(`failed: ${failed.map((f) => f.id).join(', ')}`);
  console.log('='.repeat(72));
  process.exitCode = failed.length ? 1 : 0;
}
