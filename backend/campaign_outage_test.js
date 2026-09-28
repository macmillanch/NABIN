// =========================================================================
// CAMPAIGN OUTAGE-BRANCH CHECKS (local only)
//
// Phase 4 open item: "The campaign outage branch has no test." The route answers
// an unreachable campaign store with `CAMPAIGNS_UNAVAILABLE` → HTTP 503 rather
// than an empty list, but that could only be verified by reading the code,
// because the admin route's authentication fails closed before a request could
// reach it during an outage — so there was no admin token to make the call.
//
// The 503 actually originates in CampaignRepository, which this test drives
// directly (the same closed-port-on-127.0.0.1 technique as the auth and
// checkout suites, so nothing touches a hosted environment):
//
//   * live + store unreachable — every read routes through settle(), which turns
//     a connection failure into a thrown CAMPAIGNS_UNAVAILABLE with .status 503.
//     The route's error mapper reads that 503 and answers 503.
//   * not live — listCampaigns/liveCampaigns return null, which the route maps to
//     the same 503 CAMPAIGNS_UNAVAILABLE. An empty list is never the answer to a
//     store that cannot be reached.
// =========================================================================

const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

function outcome(fn) {
  return Promise.resolve()
    .then(fn)
    .then(value => ({ threw: false, value }))
    .catch(err => ({ threw: true, code: err && err.code, status: err && (err.status || err.statusCode) }));
}

async function runChild(scenario) {
  const out = { scenario, ok: false };
  const db = require('./src/database');

  if (scenario === 'store_down_live') {
    // This.live is isLivePostgres && supabaseAdmin, both true here (URL + keys set,
    // POSTGRES_LIVE=true), so the reads take the PostgreSQL branch and settle()
    // turns the refused connection into the 503 the route forwards.
    const list = await outcome(() => db.campaignRepo.listCampaigns({}));
    out.list = { threw: list.threw, code: list.code, status: list.status };

    const get = await outcome(() => db.campaignRepo.getCampaign(crypto.randomUUID()));
    out.get = { threw: get.threw, code: get.code, status: get.status };

    const live = await outcome(() => db.campaignRepo.liveCampaigns('FOOD'));
    out.live = { threw: live.threw, code: live.code, status: live.status };

    out.ok = ['list', 'get', 'live'].every(k =>
      out[k].threw === true && out[k].code === 'CAMPAIGNS_UNAVAILABLE' && out[k].status === 503);
  } else if (scenario === 'not_live') {
    // SUPABASE_POSTGRES_LIVE=false and no keys → this.live is false → the reads
    // return null (the branch the admin list route turns into 503), never [].
    const list = await outcome(() => db.campaignRepo.listCampaigns({}));
    out.listNull = list.threw === false && list.value === null;

    const live = await outcome(() => db.campaignRepo.liveCampaigns('FOOD'));
    out.liveNull = live.threw === false && live.value === null;

    out.ok = out.listNull === true && out.liveNull === true;
  }
  console.log(JSON.stringify(out));
}

function spawnChild(scenario, env) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'campaign_outage_test.js'), scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NABIN_CAMPAIGN_CHILD: scenario, ...env }
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch (e) { /* reported below */ }
  if (!parsed) {
    return { ok: false, detail: `child printed no verdict: ${(res.stdout || '') + (res.stderr || '')}`.slice(0, 400) };
  }
  return parsed;
}

async function main() {
  const down = spawnChild('store_down_live', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key'
  });
  check('CAMP-01', down.list && down.list.threw && down.list.code === 'CAMPAIGNS_UNAVAILABLE' && down.list.status === 503,
    `listing campaigns with the store unreachable throws CAMPAIGNS_UNAVAILABLE 503, not an empty list ` +
    `(code=${down.list && down.list.code}, status=${down.list && down.list.status})${down.detail ? ' ' + down.detail : ''}`);
  check('CAMP-02', down.get && down.get.threw && down.get.code === 'CAMPAIGNS_UNAVAILABLE' && down.get.status === 503,
    `reading one campaign fails closed the same way (code=${down.get && down.get.code}, status=${down.get && down.get.status})`);
  check('CAMP-03', down.live && down.live.threw && down.live.code === 'CAMPAIGNS_UNAVAILABLE' && down.live.status === 503,
    `the client live-campaign read fails closed too (code=${down.live && down.live.code}, status=${down.live && down.live.status})`);

  const off = spawnChild('not_live', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'false',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: ''
  });
  check('CAMP-04', off.listNull === true,
    `when PostgreSQL is not the configured store at all, listCampaigns returns null (the 503 branch), ` +
    `never a real empty list${off.detail ? ' ' + off.detail : ''}`);
  check('CAMP-05', off.liveNull === true,
    `and liveCampaigns returns null the same way (liveNull=${off.liveNull})`);

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 CAMPAIGN OUTAGE BRANCH: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  console.log('========================================================================');
  process.exit(failed.length ? 1 : 0);
}

if (process.env.NABIN_CAMPAIGN_CHILD) {
  runChild(process.env.NABIN_CAMPAIGN_CHILD).catch(err => {
    console.log(JSON.stringify({ scenario: process.env.NABIN_CAMPAIGN_CHILD, ok: false, crashed: err.message }));
    process.exit(3);
  });
} else {
  main().catch(err => {
    console.error('CAMPAIGN OUTAGE BRANCH ABORTED:', err.message);
    process.exit(2);
  });
}
