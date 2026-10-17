// =========================================================================
// THE STAGING HARNESS REFUSES BEFORE IT SPAWNS
//
// `scripts/with_staging_target.js` is the wrapper that puts a hosted project in front of
// `migrate.js` and the test chain, so it is the last place a mistake can be caught. Its
// header claimed it was "verified fail-closed"; four of those claims were not implemented:
// the loaded file overwrote whatever the operator passed on the command line, an inherited
// `DATABASE_SSL=no-verify` was accepted, any non-production ref counted as "staging", and
// `nabinEnv.audit` — the guard the rest of the repo depends on — was never called.
//
// This suite exercises the harness as a function (`establishStagingTarget`), which is what
// makes each refusal observable: nothing here opens a socket, connects to a database, or
// spawns a child. The one check that reads a real configuration file reads
// `backend/.env.staging` and asserts only on the shape of the refusal, never its value.
// =========================================================================

const fs = require('fs');
const path = require('path');
const harness = require('./scripts/with_staging_target');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

const TEST_REF = harness.SANCTIONED_STAGING_REF;            // ywhxkzmbwppkdemvzlhv
const PROD_REF = harness.FORBIDDEN_PROD_REF;                // ouxvqmhuyueklnegvmxe
const OTHER_SANDBOX = 'zzzzzzzzzzzzzzzzzzzz';               // valid shape, not the sanctioned project
const PW = 'Str0ngPw-DoNotEcho';

// `loadStagingConfig` reads `backend/.env.staging` when no file is named, and that file is real
// in this repository. Every fixture below therefore names an absent file explicitly: without it a
// fixture that expects to be refused would be answered by the developer's live configuration, and
// the suite would measure the machine rather than the harness.
const scratch = path.join(__dirname, 'scratch');
if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
const NO_FILE = path.join(scratch, `staging_env_absent_${process.pid}.env`);

function jwt(role, ref) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    role, iss: 'supabase', ref, iat: 1730000000, exp: 2100000000
  })}.SIG-${role}-${ref}`;
}

/** A complete, legitimate staging configuration, delivered the way the harness accepts it. */
function stagingEnv(overrides) {
  const env = {
    NABIN_STAGING_ENV_FILE: NO_FILE,
    STAGING_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    STAGING_DATABASE_URL: `postgresql://postgres.${TEST_REF}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
    STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', TEST_REF),
    STAGING_SUPABASE_ANON_KEY: jwt('anon', TEST_REF),
    STAGING_SUPABASE_REF: TEST_REF,
  };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v === null) delete env[k]; else env[k] = v;
  }
  return env;
}

/** Run the harness and report what it decided, without letting a refusal end this suite. */
function attempt(overrides) {
  try {
    const r = harness.establishStagingTarget(stagingEnv(overrides));
    return { ok: true, r, refusal: null };
  } catch (err) {
    return { ok: false, r: null, refusal: err.code === 'STAGING_TARGET_REFUSED' ? err.message : `UNtyped: ${err.message}` };
  }
}
const refused = (id, overrides, phrase, detail) => {
  const a = attempt(overrides);
  check(id, !a.ok && String(a.refusal).includes(phrase),
    `${detail} → ${a.ok ? 'ACCEPTED, which is the bug' : `refused: ${String(a.refusal).split('\n')[0].slice(0, 150)}`}`);
  return a;
};
const accepted = (id, overrides, detail) => {
  const a = attempt(overrides);
  check(id, a.ok, `${detail}${a.ok ? '' : ` — but refused: ${a.refusal}`}`);
  return a;
};

// ------------------------------------------------ 1. the operator's environment wins

const tempEnvFile = path.join(scratch, `staging_env_fixture_${process.pid}.env`);
fs.writeFileSync(tempEnvFile, [
  'SUPABASE_URL=' + `https://${OTHER_SANDBOX}.supabase.co`,
  'DATABASE_URL=' + `postgresql://postgres.${OTHER_SANDBOX}:FixturePw-NoEcho@db.${OTHER_SANDBOX}.supabase.co:5432/postgres`,
  'SUPABASE_SERVICE_ROLE_KEY=' + jwt('service_role', OTHER_SANDBOX),
  'NABIN_SUPABASE_REF=' + OTHER_SANDBOX,
  'DATABASE_SSL=require',
].join('\n'));

// The file names a different project; the command line names the sanctioned one. Parent wins.
const parentWins = (() => {
  const env = stagingEnv({ NABIN_STAGING_ENV_FILE: tempEnvFile });
  delete env.STAGING_SUPABASE_URL; delete env.STAGING_DATABASE_URL;
  delete env.STAGING_SUPABASE_SERVICE_ROLE_KEY; delete env.STAGING_SUPABASE_ANON_KEY;
  delete env.STAGING_SUPABASE_REF;
  env.SUPABASE_URL = `https://${TEST_REF}.supabase.co`;
  env.DATABASE_URL = `postgresql://postgres.${TEST_REF}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
  env.SUPABASE_SERVICE_ROLE_KEY = jwt('service_role', TEST_REF);
  env.SUPABASE_ANON_KEY = jwt('anon', TEST_REF);
  env.NABIN_SUPABASE_REF = TEST_REF;
  try {
    return { ok: true, r: harness.establishStagingTarget(env), env };
  } catch (err) {
    return { ok: false, refusal: err.message, env };
  }
})();
check('SG-01', parentWins.ok && parentWins.env.SUPABASE_URL === `https://${TEST_REF}.supabase.co`,
  `a command-line SUPABASE_URL is not overwritten by the loaded file (got ${parentWins.env.SUPABASE_URL})`);
check('SG-02', parentWins.ok && parentWins.r.loaded.overridden.includes('SUPABASE_URL'),
  `the harness reports which keys the file did not get to set (${parentWins.r && parentWins.r.loaded.overridden.join(', ') || '(none)'})`);
check('SG-03', parentWins.ok && parentWins.r.loaded.overridden.every((k) => /^[A-Z0-9_]+$/.test(k)),
  'that report is names only — no value of an operator-supplied credential is echoed');
const fileApplied = (() => {
  const env = { NABIN_STAGING_ENV_FILE: tempEnvFile, NABIN_ALLOW_STAGING_REF: OTHER_SANDBOX };
  try {
    return { ok: true, r: harness.establishStagingTarget(env) };
  } catch (err) {
    return { ok: false, refusal: err.message };
  }
})();
check('SG-04', fileApplied.ok && fileApplied.r.loaded.source.includes('staging_env_fixture_'),
  `with nothing on the command line the file is the target (${fileApplied.ok ? fileApplied.r.loaded.keys + ' keys applied' : fileApplied.refusal})`);
fs.unlinkSync(tempEnvFile);

// ------------------------------------------- 2. production and loopback are still refused

refused('SG-05', { STAGING_SUPABASE_URL: `https://${PROD_REF}.supabase.co` },
  PROD_REF, 'the production project named as the staging target');
refused('SG-06', { STAGING_DATABASE_URL: 'postgresql://postgres:p@127.0.0.1:54322/postgres' },
  'local loopback host', 'the local Docker stack wearing a staging label');
refused('SG-07', { STAGING_SUPABASE_URL: 'https://nabin-production.example.com' },
  'Potential production indicator', 'a hostname that advertises production');
refused('SG-08', { STAGING_SUPABASE_URL: 'not a url' },
  'is not a valid URL', 'a malformed REST URL');

// ------------------------------------------- 3. TLS is the shared policy, not an inheritance

refused('SG-09', { DATABASE_SSL: 'no-verify' },
  'skip certificate verification', 'the bypass word inherited from the operator environment');
refused('SG-10', { DATABASE_SSL: 'disable' },
  'plain text', 'a hosted database connection with TLS switched off');
refused('SG-11', { DATABASE_SSL: 'sometimes' },
  'is not understood', 'a TLS mode the policy has never heard of');
const tlsUnset = accepted('SG-12', { DATABASE_SSL: null },
  'no DATABASE_SSL at all still means the connection verifies');
check('SG-13', tlsUnset.ok && tlsUnset.r.env.DATABASE_SSL === 'require',
  `the map handed to the spawned child carries an explicit verifying mode (DATABASE_SSL=${tlsUnset.r && tlsUnset.r.env.DATABASE_SSL})`);
check('SG-14', tlsUnset.ok && tlsUnset.r.tls.verification === 'required, hostname checked'
  && String(tlsUnset.r.tls.trustAnchor).includes('supabase-root-2021-ca.pem'),
  `the printed line says which anchor it will use (${tlsUnset.r && JSON.stringify(tlsUnset.r.tls)})`);
// A hosted database that is not Supabase keeps the same rule with a different anchor: the system
// trust store. Neither pinned nor bypassed. Read through the policy directly, because the pin
// stage would refuse this host as "not the sanctioned staging project" before the TLS question
// is ever asked.
const tlsOtherHost = (() => {
  try {
    return { ok: true, tls: harness.enforceTlsPolicy({
      DATABASE_URL: `postgresql://postgres:${PW}@db.acme-managed-postgres.example-hosting.net:5432/postgres`,
    }) };
  } catch (err) {
    return { ok: false, refusal: err.message };
  }
})();
check('SG-15', tlsOtherHost.ok && tlsOtherHost.tls.trustAnchor === 'system trust store'
  && tlsOtherHost.tls.verification === 'required, hostname checked',
  `a non-Supabase hosted target verifies against the system store, not a bypass (${tlsOtherHost.ok ? JSON.stringify(tlsOtherHost.tls) : tlsOtherHost.refusal})`);

// ------------------------------------------- 4. the ref is pinned, not "anything but production"

refused('SG-16', { STAGING_SUPABASE_REF: OTHER_SANDBOX },
  'not the sanctioned staging project', 'a second sandbox offered as staging');
const allowedOther = attempt({
  STAGING_SUPABASE_REF: OTHER_SANDBOX, NABIN_ALLOW_STAGING_REF: OTHER_SANDBOX,
  STAGING_SUPABASE_URL: `https://${OTHER_SANDBOX}.supabase.co`,
  STAGING_DATABASE_URL: `postgresql://postgres.${OTHER_SANDBOX}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', OTHER_SANDBOX),
  STAGING_SUPABASE_ANON_KEY: jwt('anon', OTHER_SANDBOX),
});
check('SG-17', allowedOther.ok && allowedOther.r.ref.explicitlyAllowed === true,
  `an operator who names the project on purpose is believed (${allowedOther.ok ? allowedOther.r.ref.declared : allowedOther.refusal})`);
const defaulted = (() => {
  const env = stagingEnv({});
  delete env.STAGING_SUPABASE_REF;
  try {
    return { ok: true, r: harness.establishStagingTarget(env) };
  } catch (err) {
    return { ok: false, refusal: err.message };
  }
})();
check('SG-18', defaulted.ok && defaulted.r.ref.defaulted === true && defaulted.r.env.NABIN_SUPABASE_REF === TEST_REF,
  `no declaration defaults to the sanctioned project, not to nothing (${defaulted.ok ? defaulted.r.env.NABIN_SUPABASE_REF : defaulted.refusal})`);

// ------------------------------------------- 5. an unfilled template is refused, with the fix

const pastePw = refused('SG-19', {
  STAGING_DATABASE_URL: `postgresql://postgres.${TEST_REF}:PASTE_YOUR_DATABASE_PASSWORD_HERE@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
}, 'Owner action', 'the pooler password still holding the template literal');
check('SG-20', !pastePw.ok && !String(pastePw.refusal).includes('PASTE_YOUR_DATABASE_PASSWORD_HERE'),
  'the refusal names the key and the fix, never the template value itself');
check('SG-21', !pastePw.ok && String(pastePw.refusal).includes(TEST_REF),
  'and names the project whose password is missing');
refused('SG-22', {
  STAGING_DATABASE_URL: `postgresql://postgres.${TEST_REF}:YOUR_STAGING_DB_PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
}, 'unfilled template', 'the .env.staging.example password, copied without editing');
refused('SG-23', { STAGING_SUPABASE_ANON_KEY: 'your-staging-anon-key-here' },
  'unfilled template', 'a placeholder anon key reaches the placeholder refusal, not the audit');
refused('SG-24', {
  STAGING_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
  STAGING_DATABASE_URL: `postgresql://postgres:${PW}@db.${TEST_REF}.supabase.co:5432/postgres`,
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'your-staging-service-role-key-here',
  STAGING_SUPABASE_ANON_KEY: jwt('anon', TEST_REF),
  STAGING_SUPABASE_REF: TEST_REF,
}, 'SUPABASE_SERVICE_ROLE_KEY', 'a real DSN password does not excuse an unfilled service-role key');

// The direct regression for the defect this suite found first: `STAGING_SUPABASE_ANON_KEY` was
// assigned to `SUPABASE_ANON_KEY` with the wrong side, so the operator's anon credential landed
// nowhere and both anon-slot checks (service_role in the client slot, an unfilled template)
// silently had nothing to look at.
const ANON_FIXTURE = jwt('anon', TEST_REF);
const mappedAnon = attempt({ STAGING_SUPABASE_ANON_KEY: ANON_FIXTURE });
check('SG-24b', mappedAnon.ok && mappedAnon.r.env.SUPABASE_ANON_KEY === ANON_FIXTURE,
  `a command-line anon credential arrives in the slot it names (${mappedAnon.ok ? (mappedAnon.r.env.SUPABASE_ANON_KEY ? 'present' : 'UNSET — the self-assignment bug') : mappedAnon.refusal})`);
check('SG-24c', mappedAnon.ok && mappedAnon.r.loaded.keys === 5,
  `the applied-key count is what was actually mapped, not a hardcoded number (${mappedAnon.ok ? mappedAnon.r.loaded.keys : '-'} of 5)`);

// The direct-connection shape must be accepted — the harness is how `migrate.js` reaches DDL.
accepted('SG-25', {
  STAGING_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
  STAGING_DATABASE_URL: `postgresql://postgres:${PW}@db.${TEST_REF}.supabase.co:5432/postgres`,
}, 'a direct db.<ref> host with a real-shaped password passes');

// ------------------------------------------- 6. nabinEnv runs on the final map

refused('SG-26', { STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt('anon', TEST_REF) },
  'holds a', 'an anon key in the service-role slot, caught by the audit the harness now runs');
refused('SG-27', { STAGING_SUPABASE_ANON_KEY: jwt('service_role', TEST_REF) },
  'service_role key', 'a privileged credential in the slot a client reads');
refused('SG-28', { STAGING_DATABASE_URL: `postgresql://postgres:${PW}@db.${PROD_REF}.supabase.co:5432/postgres` },
  PROD_REF, 'staging REST URL with the production database');
refused('SG-29', { STAGING_SUPABASE_SERVICE_ROLE_KEY: null },
  'Missing required staging configuration keys', 'no service-role key at all');
const mismatch = attempt({
  STAGING_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
  STAGING_DATABASE_URL: `postgresql://postgres.${OTHER_SANDBOX}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
});
check('SG-30', !mismatch.ok && /project/i.test(String(mismatch.refusal)),
  `URLs that disagree with each other are refused, not averaged (${String(mismatch.refusal).split('\n')[0].slice(0, 130)})`);

// ------------------------------------------- 7. the CLI contract: refuse, then spawn

const harnessSource = fs.readFileSync(path.join(__dirname, 'scripts', 'with_staging_target.js'), 'utf8');
const establishIndex = harnessSource.indexOf('establishStagingTarget(process.env)');
const spawnIndex = harnessSource.indexOf('cp.spawn(');
check('SG-31', establishIndex !== -1 && spawnIndex !== -1 && establishIndex < spawnIndex,
  `the target is established before the child is spawned (establish at ${establishIndex}, spawn at ${spawnIndex})`);
check('SG-32', typeof harness.establishStagingTarget === 'function',
  'the decision is exported, so a refusal is observable instead of an exit code nobody reads');
const typed = (() => {
  try {
    harness.establishStagingTarget({ NABIN_STAGING_ENV_FILE: NO_FILE });
    return null;
  } catch (err) { return err; }
})();
check('SG-33', typed && typed.code === 'STAGING_TARGET_REFUSED',
  `an empty environment refuses with the typed error the CLI turns into exit 2 (${typed && typed.code})`);
const canonical = accepted('SG-34', {}, 'the legitimate staging map is normalized the way nabinEnv expects');
check('SG-35', canonical.ok && canonical.r.env.NABIN_ENV === 'testing'
  && canonical.r.env.NODE_ENV === 'production' && canonical.r.env.NABIN_TARGET_LABEL === 'cloud-staging',
  `NABIN_ENV=${canonical.r && canonical.r.env.NABIN_ENV} NODE_ENV=${canonical.r && canonical.r.env.NODE_ENV} label=${canonical.r && canonical.r.env.NABIN_TARGET_LABEL}`);

// ------------------------------- 8. the real backend/.env.staging: what it says today

const realStaging = path.resolve(__dirname, '.env.staging');
if (fs.existsSync(realStaging)) {
  const env = { NABIN_STAGING_ENV_FILE: realStaging };
  let outcome;
  try {
    outcome = { ok: true, r: harness.establishStagingTarget(env) };
  } catch (err) {
    outcome = { ok: false, refusal: err.message };
  }
  const loadedText = fs.readFileSync(realStaging, 'utf8');
  const realPassword = (() => {
    const line = /^DATABASE_URL=(.*)$/m.exec(loadedText);
    if (!line) return null;
    try { return decodeURIComponent(new URL(line[1]).password || ''); } catch (e) { return null; }
  })();
  check('SG-36', outcome.ok || /Owner action|unfilled template/.test(String(outcome.refusal)),
    `the live staging file is either ready or refused with the owner action (${String(outcome.refusal || 'ready to spawn').split('\n')[0].slice(0, 140)})`);
  check('SG-37', !outcome.ok && realPassword ? !String(outcome.refusal).includes(realPassword) : true,
    'and the refusal repeats no part of the live credential');
  check('SG-38', !/no-verify/.test(loadedText),
    'backend/.env.staging asks for verification, not a bypass');
} else {
  check('SG-36', true, 'no backend/.env.staging to read — the harness refuses an absent target anyway');
  check('SG-37', true, 'nothing to leak from a file that is not there');
  check('SG-38', true, 'no bypass to check while the staging file is absent');
}

// ---------------------------------------------------------------- report

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('✅ Staging harness holds: the operator wins, production and loopback are refused, TLS is policy-driven, the ref is pinned, an unfilled credential names the owner action, and nothing spawns before that.');
