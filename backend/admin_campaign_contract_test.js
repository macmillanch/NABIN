/*
 * The admin console's sponsored-campaign surface must speak the contract the repository actually
 * enforces, and must describe its own results in terms of what the store confirmed.
 *
 * The defect this file was written for: the campaign panel and its two modals were written against
 * the in-memory engine that used to answer `/api/admin/advertisements`, and that engine invented
 * fields the `advertisements` table has never had — brand, tagline, industry, sponsor badge, CTA
 * text, target service, bid rate, priority. PostgreSQL answers instead, and `AdvertisementRepository`
 * refuses any write naming one of them (`ADVERTISEMENT_FIELD_UNSUPPORTED`). So every "Deploy
 * Campaign" and every "Save Updates Live" click has been a guaranteed 400 for as long as the real
 * store has been live, while the operator was told the campaign was deployed and the audit trail
 * stayed empty. The same gap breaks the read side: `mapRowToDTO` reports bidRateCpm and brand as
 * `null` *by design*, the row template calls `ad.bidRateCpm.toFixed(2)` on it, and the `TypeError`
 * thrown inside `Array.map()` is swallowed by `loadPromotions`' own outer `catch` — so the campaign
 * table silently never paints at all. The Revenue KPI reads `adRevenueEstimate`, a number the route
 * deliberately refuses to compute, and prints `₹NaN.00` where the backend's answer is
 * `monetization.available: false`.
 *
 * Everything the file asserts is derived, not copied: the unsupported and writable field lists come
 * from the repository module itself, the by-design-null fields come from running a real row through
 * `mapRowToDTO`, the required fields come out of `toInsert`'s own validation messages along with the
 * aliases it accepts for each, and the placement values come out of the `<select>` elements in the
 * dashboard and are resolved by the repository's own `resolvePlacement`. Nothing here is a restated
 * enum, so a field or a slot added tomorrow is caught by the same rules.
 *
 * Two kinds of claim are checked. Executable ones run the shipped backend code, because a rule
 * about "the fields that cannot be stored" is worthless if the list was guessed. Static ones read
 * the shipped HTML, because the browser is where the payload, the message and the crash live — the
 * dashboard is a single inline-script file and is the whole surface. Both are green only if they
 * actually found something to judge: every audit here reports the number of sites it inspected, and
 * finding zero is a failure, not a pass.
 */
process.env.NABIN_TEST_MODE = 'true';
const fs = require('fs');
const path = require('path');

const DASH = path.join(__dirname, '..', 'admin_dashboard.html');
const REPO = path.join(__dirname, 'src', 'repositories', 'AdvertisementRepository.js');
const SERVER = path.join(__dirname, 'src', 'server.js');
const SRC = fs.readFileSync(DASH, 'utf8');
const REPO_SRC = fs.readFileSync(REPO, 'utf8');
const SERVER_SRC = fs.readFileSync(SERVER, 'utf8');

const AdRepoModule = require('./src/repositories/AdvertisementRepository');
const { UNSUPPORTED_FIELDS, resolvePlacement, mapRowToDTO, pickUnsupported, pickUnknown } = AdRepoModule;

// The module exports the two refusal functions rather than its field lists, so acceptance is
// measured by asking the code that enforces it — a key is storable exactly when neither the
// unsupported filter nor the unknown filter names it.
const keyIsStorable = (key) => pickUnsupported({ [key]: 1 }).length === 0 && pickUnknown({ [key]: 1 }).length === 0;

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

// --- the contract, read off the shipped backend -------------------------------

// A row in the shape `advertisements` actually returns (the columns migration 004 gives).
const SAMPLE_ROW = {
  id: 'a0725180-29c1-49e9-90fc-d56a29ac04b1',
  title: 'Grocery hero banner - house campaign',
  placement: 'HOME_BANNER',
  merchant_id: null,
  image_url: 'https://nabin.example.com/ads/probe.png',
  target_url: '/grocery',
  status: 'ACTIVE',
  start_date: '2026-09-01T00:00:00+00:00',
  end_date: '2026-12-31T23:59:59+00:00',
  clicks: 0,
  impressions: 1196,
  created_at: '2026-09-22T05:49:51.275708+00:00'
};
const DTO = mapRowToDTO(SAMPLE_ROW);
const NULL_FIELDS = Object.keys(DTO).filter((k) => DTO[k] === null);
const NOT_STORED = new Set([...UNSUPPORTED_FIELDS, ...NULL_FIELDS]);

// --- small scanners ----------------------------------------------------------

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
function endOfTemplate(text, i) {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && text[j + 1] === '{') { j = matchPair(text, j + 1, '{', '}') + 1; continue; }
    j++;
  }
  return j;
}
function matchPair(text, i, open, close) {
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { i = endOfString(text, i); continue; }
    if (c === '`') { i = endOfTemplate(text, i); continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
    i++;
  }
  return -1;
}

// The body of a top-level `function name(...) { ... }`, or null if the console no longer has it.
function functionBody(name, text = SRC) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const m = re.exec(text);
  if (!m) return null;
  const brace = text.indexOf('{', text.indexOf(')', m.index));
  if (brace < 0) return null;
  const close = matchPair(text, brace, '{', '}');
  return close < 0 ? null : text.slice(brace, close + 1);
}

// The keys of the object literal handed to `JSON.stringify(…)` in a handler, in source order.
function payloadKeys(name) {
  const body = functionBody(name);
  if (!body) return null;
  const at = body.indexOf('JSON.stringify(');
  if (at < 0) return null;
  const open = at + 'JSON.stringify('.length;
  const close = matchPair(body, open, '(', ')');
  const inner = body.slice(open, close);
  const brace = inner.indexOf('{');
  if (brace < 0) return null;
  const end = matchPair(inner, brace, '{', '}');
  const literal = inner.slice(brace + 1, end);
  const keys = [];
  let depth = 0, str = null, token = '';
  const flush = () => {
    const t = token.trim();
    token = '';
    if (!t) return;
    const named = /^([A-Za-z_$][\w$]*)\s*:/.exec(t);
    if (named) keys.push(named[1]);
    else if (/^[A-Za-z_$][\w$]*$/.test(t)) keys.push(t); // shorthand
  };
  for (const c of literal) {
    if (str) { if (c === '\\') continue; if (c === str) str = null; token += c; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; token += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { flush(); continue; }
    token += c;
  }
  flush();
  return keys;
}

// The `<option value="…">` list of a `<select>` by id.
function optionValues(selectId) {
  const m = new RegExp('<select[^>]*\\bid="' + selectId + '"[^>]*>([\\s\\S]*?)</select>').exec(SRC);
  if (!m) return null;
  return [...m[1].matchAll(/<option[^>]*\bvalue="([^"]*)"/g)].map((o) => o[1]);
}

// A slice of a source file between a start marker and the balanced block that follows it.
function blockAfter(text, startRe) {
  const m = startRe.exec(text);
  if (!m) return null;
  const brace = text.indexOf('{', m.index + m[0].length - 1);
  if (brace < 0) return null;
  const close = matchPair(text, brace, '{', '}');
  return close < 0 ? null : text.slice(brace, close + 1);
}

// --- 0. the backend facts this whole file rests on ---------------------------

check('CAMPAIGN-00',
  UNSUPPORTED_FIELDS.length > 0 && NULL_FIELDS.length > 0 && pickUnsupported({ brand: 'x' })[0] === 'brand' && pickUnknown({ notAFieldAtAll: 1 })[0] === 'notAFieldAtAll' && pickUnknown({ title: 'x' }).length === 0 && DTO.bidRateCpm === null && DTO.brand === null && DTO.service === 'ALL',
  `the shipped repository answers a real row with ${NULL_FIELDS.length} by-design-null field(s) [${NULL_FIELDS.join(', ')}] and service '${DTO.service}', refuses ${UNSUPPORTED_FIELDS.length} unstorable field(s) [${UNSUPPORTED_FIELDS.join(', ')}], and its own pickUnknown accepts title but rejects an invented key — so the storable set below is measured, not restated`);

// --- 1. no method call on a value the campaign DTO reports as null ------------

// Scoped to the campaign surface, because `brand` means something different to the grocery
// catalogue below it — there the column is real. A campaign row is the only shape where these
// fields are null by design, so this is where a dereference is a guaranteed crash.
const CAMPAIGN_FNS = ['loadPromotions', 'openEditAdModal', 'submitDeployAdModal', 'submitEditAdModal', 'toggleAdStatus', 'deleteAdCampaign'];
const methodCallsOnNull = [];
let auditedCampaignFns = 0;
for (const fn of CAMPAIGN_FNS) {
  const body = functionBody(fn);
  if (!body) continue;
  auditedCampaignFns++;
  for (const field of NULL_FIELDS) {
    const re = new RegExp('[\\w$]+\\.' + field + '\\s*(?:\\.|\\?\\.)\\s*[A-Za-z_$][\\w$]*\\s*\\(', 'g');
    for (const m of body.matchAll(re)) {
      const line = SRC.slice(0, SRC.indexOf(body) + m.index).split('\n').length;
      methodCallsOnNull.push(`${fn} line ${line}: ${m[0].trim()}`);
    }
  }
}
check('CAMPAIGN-01', auditedCampaignFns > 0 && methodCallsOnNull.length === 0,
  methodCallsOnNull.length
    ? `${methodCallsOnNull.length} call(s) in the ${auditedCampaignFns} campaign handler(s) invoke a method on a field mapRowToDTO always reports null (${NULL_FIELDS.join(', ')}), which throws inside Array.map and is swallowed by loadPromotions' own catch — the table then silently stops rendering: ${methodCallsOnNull.join(' | ')}`
    : `no method is called on the ${NULL_FIELDS.length}-field by-design-null set anywhere in the ${auditedCampaignFns} campaign handler(s), so a stored campaign row always paints`);

// --- 2. a write payload may only name fields the store accepts ----------------

const writeHandlers = ['submitDeployAdModal', 'submitEditAdModal'];
const payloadAudit = [];
for (const name of writeHandlers) {
  const keys = payloadKeys(name);
  payloadAudit.push({ name, keys });
}
const offending = [];
for (const { name, keys } of payloadAudit) {
  if (!keys) { offending.push(`${name}: no JSON.stringify payload found (the audit cannot see what it sends)`); continue; }
  for (const k of keys) {
    if (UNSUPPORTED_FIELDS.includes(k)) offending.push(`${name} sends '${k}' — ADVERTISEMENT_FIELD_UNSUPPORTED, so the whole request is refused`);
    else if (!keyIsStorable(k)) offending.push(`${name} sends '${k}' — ADVERTISEMENT_FIELD_UNKNOWN, the repository has no mapping for it`);
  }
}
check('CAMPAIGN-02', payloadAudit.every((p) => p.keys) && offending.length === 0,
  offending.length
    ? `${offending.length} rejected key(s) across ${payloadAudit.length} write handler(s): ${offending.join(' | ')}`
    : `both write payloads (${payloadAudit.map((p) => p.name + ' → [' + p.keys.join(', ') + ']').join('; ')}) name only fields the repository lists as writable`);

// --- 3. and every field the store insists on is in it -------------------------

// Derived from toInsert's own validation messages, together with the aliases it reads for each.
// Only "X is required" counts as required; a relational message like "endDate must be after
// startDate" is a shape rule on a field already covered, and an enum rule like "status must be one
// of" is not a requirement at all because toInsert defaults status when it is absent.
const toInsertBody = blockAfter(REPO_SRC, /function toInsert\(/);
const requiredFields = toInsertBody
  ? [...new Set([...toInsertBody.matchAll(/errors\.push\(\s*[`'"]([A-Za-z_]+)\s+is required/g)].map((m) => m[1]))]
  : [];
const placementRequired = Boolean(toInsertBody) && /if \(!placement\)/.test(toInsertBody);
const placementKeys = (() => {
  if (!toInsertBody) return ['placement'];
  const m = /resolvePlacement\((payload\.[A-Za-z_]+(?:\s*\|\|\s*payload\.[A-Za-z_]+)*)\)/.exec(toInsertBody);
  return m ? [...m[1].matchAll(/payload\.([A-Za-z_]+)/g)].map((x) => x[1]) : ['placement'];
})();
if (placementRequired) requiredFields.push('placement');
const aliasesFor = (field) => (field === 'placement' ? placementKeys : (() => {
  const re = new RegExp('payload\\.' + field + '((?:\\s*\\|\\|\\s*payload\\.[a-z_]+)*)');
  const m = re.exec(toInsertBody);
  const names = [field];
  if (m) for (const alt of m[1].matchAll(/payload\.([a-z_]+)/g)) names.push(alt[1]);
  return names;
})());
const createKeys = payloadKeys('submitDeployAdModal');
const missingRequired = toInsertBody && createKeys
  ? requiredFields.filter((f) => !aliasesFor(f).some((a) => createKeys.includes(a)))
  : [];
check('CAMPAIGN-03', requiredFields.length > 0 && Boolean(toInsertBody) && missingRequired.length === 0,
  !toInsertBody
    ? 'toInsert could not be located, so the required-field contract was never read'
    : requiredFields.length === 0
      ? 'no required field was derived — the check would pass vacuously, so it is a failure'
      : missingRequired.length
        ? `the repository's own validator requires ${requiredFields.join(', ')} but the deploy payload sends none of ${missingRequired.join(', ')}: the request fails validation instead of creating a campaign`
        : `the deploy payload covers all ${requiredFields.length} field(s) toInsert demands (${requiredFields.join(', ')}), read off its own error messages and accepted aliases`);

// --- 4. every placement the console offers is one the schema knows ------------

const placementSelects = ['adModalSlot', 'editAdSlot'];
const badOptions = [];
let inspectedOptions = 0;
for (const id of placementSelects) {
  const opts = optionValues(id);
  if (!opts) { badOptions.push(`${id}: select not found`); continue; }
  for (const v of opts) {
    inspectedOptions++;
    const resolved = resolvePlacement(v);
    if (!resolved.placement) badOptions.push(`${id} offers '${v}', which resolves to no placement and is refused`);
  }
}
check('CAMPAIGN-04', inspectedOptions > 0 && badOptions.length === 0,
  badOptions.length
    ? `${badOptions.length} of ${inspectedOptions} placement option(s) cannot be resolved by the repository's own resolvePlacement: ${badOptions.join(' | ')}`
    : `all ${inspectedOptions} placement option(s) resolve to a placement the schema's CHECK constraint admits`);

// --- 5. an unset field is not an invitation to print a default ----------------

// The edit form prefill must not hand back a plausible number or label for a field no column holds.
const editBody = functionBody('openEditAdModal');
const inventions = [];
if (editBody) {
  for (const field of NOT_STORED) {
    const re = new RegExp('[\\w$]+\\.' + field + '\\s*\\|\\|', 'g');
    for (const m of editBody.matchAll(re)) inventions.push(m[0].trim());
  }
}
check('CAMPAIGN-05', Boolean(editBody) && inventions.length === 0,
  !editBody
    ? 'openEditAdModal could not be found, so the prefill was never audited'
    : inventions.length
      ? `${inventions.length} prefill(s) substitute a hard-coded default for a field the store cannot hold: ${inventions.join(', ')}. The operator then believes an invented bid rate or brand is the saved value`
      : `no prefill of the ${NOT_STORED.size} unstorable field(s) replaces an absent value with a literal, so the form cannot show a bid rate or brand that was never stored`);

// --- 6. a claim about durability may only come from the durability flags ------

const claimHandlers = ['submitDeployAdModal', 'submitEditAdModal', 'deleteAdCampaign'];
// The durability sentence belongs in one helper the three mutation handlers share, so the guard
// proves two things: the helper itself reads the backend's flags, and every handler routes its
// message through it. A missing helper makes all three handlers blind, so the check cannot pass by
// finding nothing.
const durabilityHelper = functionBody('adStoreNotice');
const helperReadsFlags = Boolean(durabilityHelper) && /persisted/.test(durabilityHelper) && /dataSource/.test(durabilityHelper);
const blindClaims = helperReadsFlags
  ? claimHandlers.filter((n) => {
      const body = functionBody(n);
      return !body || !/adStoreNotice\s*\(/.test(body);
    })
  : claimHandlers;
// The claim wording is judged on the campaign surface only: the six handlers plus the two campaign
// modals that submit them. Scanning the whole file would make this check answer for a different
// surface's wording — the master-catalogue SKU save is the same defect class and is tracked there.
const campaignModalBlocks = ['deployAdModal', 'editAdModal'].map((id) => {
  const at = SRC.indexOf(`id="${id}"`);
  if (at < 0) return null;
  const end = SRC.indexOf('</form>', at);
  return end < 0 ? null : SRC.slice(at, end + 7);
});
const campaignText = CAMPAIGN_FNS.map((f) => functionBody(f) || '').join('\n')
  + '\n' + campaignModalBlocks.map((b) => b || '').join('\n');
const liveDeployText = [...campaignText.matchAll(/deployed live|updated successfully|Save Updates Live|Deploy Campaign to App/g)].map((m) => m[0]);
check('CAMPAIGN-06',
  blindClaims.length === 0 && liveDeployText.length === 0 && CAMPAIGN_FNS.length === 6 && campaignModalBlocks.every(Boolean),
  !helperReadsFlags
    ? `adStoreNotice ${durabilityHelper ? 'exists but does not read the persisted / dataSource flags' : 'is missing'}, so a mutation message cannot be derived from the store's answer and all ${claimHandlers.length} handler(s) are unverified`
    : campaignModalBlocks.some((b) => !b)
      ? `one of the two campaign modals could not be located, so the region the claim wording lives in was never read`
      : blindClaims.length || liveDeployText.length
        ? `${blindClaims.length ? `handler(s) whose message does not go through the durability helper: ${blindClaims.join(', ')}. ` : ''}${liveDeployText.length ? `${liveDeployText.length} unconditional claim(s) still in the ${CAMPAIGN_FNS.length} handlers and 2 modals: ${liveDeployText.join(', ')}` : ''}`
        : `all ${claimHandlers.length} campaign mutation handlers derive their message from the persisted / dataSource / degraded flags the route already returns, and no hard-coded "live" or "successfully" wording is left in the ${CAMPAIGN_FNS.length} campaign handler(s) or either campaign modal`);

// --- 7. the Revenue KPI reads the number the route sends or says there is none -

const adMetricsBlock = blockAfter(SERVER_SRC, /app\.get\('\/api\/admin\/advertisements'/);
const revenueKeysInRoute = adMetricsBlock ? [...adMetricsBlock.matchAll(/adRevenueEstimate/g)] : [];
const routePublishesMonetization = Boolean(adMetricsBlock) && /monetization/.test(adMetricsBlock);
const dashboardReadsRevenueEstimate = [...SRC.matchAll(/adRevenueEstimate/g)].length;
const dashboardReadsMonetization = /monetization/.test(SRC);
check('CAMPAIGN-07',
  Boolean(adMetricsBlock) && routePublishesMonetization && revenueKeysInRoute.length === 0 && dashboardReadsRevenueEstimate === 0 && dashboardReadsMonetization,
  !adMetricsBlock
    ? 'the admin advertisements GET handler could not be located, so the metrics contract was never read'
    : `the route sends monetization (${routePublishesMonetization ? 'with an explicit availability answer' : 'MISSING'}) and never a revenue estimate (${revenueKeysInRoute.length} mention(s)); the console references adRevenueEstimate ${dashboardReadsRevenueEstimate} time(s) and monetization ${dashboardReadsMonetization ? 'yes' : 'NO'}`);

// --- 8. the campaign is named by the one label the table stores ---------------

const renderBody = functionBody('loadPromotions');
const brandRenders = renderBody ? [...renderBody.matchAll(/ad\.brand\b/g)].length : -1;
const subtitleNamesTitle = (() => {
  const b = functionBody('openEditAdModal');
  if (!b) return false;
  const m = /editAdSubtitle[\s\S]{0,200}?`([^`]*)`/.exec(b);
  return Boolean(m) && /ad\.title/.test(m[1]) && !/ad\.brand/.test(m[1]);
})();
check('CAMPAIGN-08', Boolean(renderBody) && brandRenders === 0 && subtitleNamesTitle,
  !renderBody
    ? 'loadPromotions could not be found'
    : `the campaign table references ad.brand ${brandRenders} time(s) (it is always null) and the edit subtitle names ${subtitleNamesTitle ? 'the stored title' : 'something other than ad.title'}`);

// --- 9. the file is still valid JS, and no second copy shadows the fix --------

const broken = [];
for (const m of SRC.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  try { new Function(m[1]); } catch (e) { broken.push(e.message); }
}
check('CAMPAIGN-09', broken.length === 0,
  broken.length ? `an inline script no longer parses — ${broken.join(' | ')}` : 'both inline scripts parse, so the contract fix did not clip a string or a template boundary');

const shadowed = [];
for (const name of ['loadPromotions', 'submitDeployAdModal', 'submitEditAdModal', 'openEditAdModal', 'deleteAdCampaign', 'toggleAdStatus']) {
  const count = [...SRC.matchAll(new RegExp('function\\s+' + name + '\\s*\\(', 'g'))].length;
  if (count !== 1) shadowed.push(`${name} (${count} declarations)`);
}
check('CAMPAIGN-10', shadowed.length === 0,
  shadowed.length
    ? `campaign handler(s) declared more than once, where only the last copy runs: ${shadowed.join(', ')}`
    : 'each campaign handler exists exactly once, so the payload and message the guard judged is the one the browser runs');

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
