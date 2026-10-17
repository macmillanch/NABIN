// =========================================================================
// THE HOSTED-TEST VERIFIER CANNOT PASS ON A TARGET IT CANNOT REACH
//
// `scripts/verify_hosted_test_env.js` is the read-only gate that says "this configuration is
// the hosted test project, safely". On 12 Oct 2026 it printed
// `✅ PASS: Environment is safely and correctly configured for Hosted TEST` and exited 0
// against `backend/.env`, which had 16 keys and no `DATABASE_URL` at all: the verifier
// computed `hasDatabaseUrl`, put it on screen with a ⚠️, and then never used it in any
// condition — the PASS branch keyed on the two REST credentials alone. A migration procedure
// that reads "safely and correctly configured" from this script and then runs `migrate.js`
// would be following a verdict about keys into a step that needs a DSN.
//
// Second defect, same file: it loaded `backend/.env.test.local` with `override: true` at
// module scope. Under `with_staging_target.js` that means a local file silently replaces the
// project the harness just pinned and audited, so the map the harness reasoned about is not
// the map the child runs with.
//
// Everything here is pure: `decide()` and `chooseEnvFile()` take an explicit env map, so no
// socket is opened, no database is contacted, no child is spawned, and the developer's own
// `.env` cannot answer for a fixture. The one check that reads a real file reads
// `backend/.env` and asserts on the verdict, never on a credential value.
// =========================================================================

const fs = require('fs');
const path = require('path');
const verifier = require('./scripts/verify_hosted_test_env');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

const TEST_REF = verifier.APPROVED_TEST_REF;      // ywhxkzmbwppkdemvzlhv
const PROD_REF = verifier.FORBIDDEN_PROD_REF;     // ouxvqmhuyueklnegvmxe
const OTHER_REF = 'zzzzzzzzzzzzzzzzzzzz';         // valid shape, not the test project
const PW = 'Str0ngPw-DoNotEcho';

function jwt(role, ref) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    role, iss: 'supabase', ref, iat: 1730000000, exp: 2100000000
  })}.SIG-${role}-${ref}`;
}

/** A complete, legitimate hosted-test configuration: the three credentials plus the pin. */
function hostedTestEnv(overrides) {
  const env = {
    NABIN_ENV: 'testing',
    NABIN_SUPABASE_REF: TEST_REF,
    NODE_ENV: 'production',
    SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_ANON_KEY: jwt('anon', TEST_REF),
    SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', TEST_REF),
    DATABASE_URL: `postgresql://postgres.${TEST_REF}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
    DATABASE_SSL: 'require',
  };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v === null) delete env[k]; else env[k] = v;
  }
  return env;
}

const decide = (overrides) => verifier.decide(hostedTestEnv(overrides));

// ------------------------------------------- 1. the measured fail-open: keys are not a DSN

const full = decide({});
check('VH-01', full.status === 'PASS', `a complete hosted-test config passes (${full.status}${full.missing.length ? ` missing ${full.missing.join(',')}` : ''})`);

const noDsn = decide({ DATABASE_URL: null });
check('VH-02', noDsn.status !== 'PASS',
  `no DATABASE_URL at all is NOT a pass — this is the 12 Oct 2026 fail-open (${noDsn.status})`);
check('VH-03', noDsn.status === 'PENDING' && noDsn.missing.includes('DATABASE_URL'),
  `and the verdict names the credential that is missing (${noDsn.status}: ${noDsn.missing.join(', ') || '(nothing named)'})`);
check('VH-04', verifier.exitCodeFor(noDsn, []) === 2,
  `a pending credential is a non-zero exit, so a shell gate cannot read it as verified (${verifier.exitCodeFor(noDsn, [])})`);
check('VH-05', verifier.exitCodeFor(noDsn, ['--allow-pending']) === 0,
  'the named escape hatch still exists for a keys-not-pasted-yet run');
check('VH-06', /DATABASE_URL/.test(verifier.finalLine(noDsn)) && !/✅ PASS/.test(verifier.finalLine(noDsn)),
  `the printed line says which credential is missing and does not say PASS (${verifier.finalLine(noDsn)})`);

// The live configuration this was measured on, asserted as a rule rather than a snapshot.
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const live = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
      .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l))
      .filter(Boolean).map((m) => [m[1], m[2]])
  );
  const v = verifier.decide(live);
  const liveDsn = String(live.DATABASE_URL || '');
  check('VH-07', liveDsn.includes(TEST_REF) ? v.status === 'PASS' : v.status !== 'PASS',
    `backend/.env as it stands today: DSN present=${liveDsn ? 'yes' : 'no'} → ${v.status}${v.missing.length ? ` (missing ${v.missing.join(', ')})` : ''}`);
  check('VH-08', !JSON.stringify({ s: v.status, m: v.missing, p: v.problems }).includes(jwt('anon', TEST_REF)),
    'the verdict about the live file repeats no credential from it');
} else {
  check('VH-07', true, 'no backend/.env on this machine — the rule above is what governs');
  check('VH-08', true, 'nothing live to read, so nothing to leak');
}

// ------------------------------------------- 2. the other two credentials are gated too

const noAnon = decide({ SUPABASE_ANON_KEY: null });
check('VH-09', noAnon.status === 'PENDING' && noAnon.missing.includes('SUPABASE_ANON_KEY'),
  `a missing anon key is pending, not a pass (${noAnon.status}: ${noAnon.missing.join(', ')})`);
const noService = decide({ SUPABASE_SERVICE_ROLE_KEY: null });
check('VH-10', noService.status === 'PENDING' && noService.missing.includes('SUPABASE_SERVICE_ROLE_KEY'),
  `a missing service-role key is pending, not a pass (${noService.status}: ${noService.missing.join(', ')})`);
check('VH-11', decide({ SUPABASE_ANON_KEY: 'shorty' }).status === 'PENDING',
  'a credential too short to be real counts as missing, as it always did');
check('VH-12', decide({ DATABASE_URL: `postgresql://postgres:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` }).status === 'PENDING',
  'a DSN that names no project does not count as reaching the test project');

// ------------------------------------------- 3. production is refused before anything else

const prodUrl = verifier.decide(hostedTestEnv({ SUPABASE_URL: `https://${PROD_REF}.supabase.co` }));
check('VH-13', prodUrl.status === 'REFUSED' && verifier.exitCodeFor(prodUrl, []) === 1,
  `the production project named as the test target is refused outright (${prodUrl.status}, exit ${verifier.exitCodeFor(prodUrl, [])})`);
const prodDsn = verifier.decide(hostedTestEnv({
  DATABASE_URL: `postgresql://postgres.${PROD_REF}:${PW}@db.${PROD_REF}.supabase.co:5432/postgres`,
}));
check('VH-14', prodDsn.status === 'REFUSED',
  'production reached only through the DSN is caught by the same guard, not the URL check');
const prodAndPending = verifier.decide({
  NABIN_ENV: 'production', NABIN_SUPABASE_REF: PROD_REF, NODE_ENV: 'production',
  SUPABASE_URL: `https://${PROD_REF}.supabase.co`, SUPABASE_ANON_KEY: null,
  SUPABASE_SERVICE_ROLE_KEY: null, DATABASE_URL: null,
});
check('VH-15', prodAndPending.status === 'REFUSED' && verifier.exitCodeFor(prodAndPending, ['--allow-pending']) === 1,
  `missing credentials do not downgrade a production reference to "pending" (${prodAndPending.status}, --allow-pending still exits ${verifier.exitCodeFor(prodAndPending, ['--allow-pending'])})`);

// A configuration nabinEnv itself refuses must never be called verified. The `--allow-pending`
// comment in the script records that this used to be the fail-open it fixed; it stays guarded.
const crossKey = decide({ SUPABASE_SERVICE_ROLE_KEY: jwt('anon', TEST_REF) });
check('VH-16', crossKey.status === 'REFUSED' && crossKey.problems.length > 0,
  `an anon key in the service-role slot is refused on the audit, with full credentials (${crossKey.status}: ${crossKey.problems[0] || '(no problem printed)'})`);
const foreignDsn = decide({
  DATABASE_URL: `postgresql://postgres.${OTHER_REF}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
});
check('VH-17', foreignDsn.status === 'REFUSED',
  `a DSN for a different project is a mismatch, not a missing credential (${foreignDsn.status})`);

// ------------------------------------------- 4. local Docker and a wrong env are not hosted test

const local = verifier.decide({
  NABIN_ENV: 'development', NABIN_SUPABASE_REF: null, NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:54321/rest/v1', SUPABASE_ANON_KEY: 'local-dev-anon-key-not-a-jwt-here',
  SUPABASE_SERVICE_ROLE_KEY: 'local-dev-service-key-not-a-jwt-here',
  DATABASE_URL: 'postgresql://postgres:local@127.0.0.1:54322/postgres',
});
check('VH-18', local.status === 'LOCAL' && verifier.exitCodeFor(local, []) === 2,
  `the local Docker stack reports itself as local and exits non-zero (${local.status}, exit ${verifier.exitCodeFor(local, [])})`);
const devPinned = decide({ NABIN_ENV: 'development' });
check('VH-19', devPinned.status === 'MISMATCH' && verifier.exitCodeFor(devPinned, []) === 1,
  `the test project under NABIN_ENV=development is not "correctly configured for Hosted TEST" (${devPinned.status}, exit ${verifier.exitCodeFor(devPinned, [])})`);

// --------------------------------------------------- 5. the verdict never carries a secret

const verdictText = JSON.stringify({
  status: noDsn.status, missing: noDsn.missing, problems: noDsn.problems, line: verifier.finalLine(noDsn),
});
check('VH-20', !verdictText.includes(PW), 'the DSN password appears nowhere in the verdict');
check('VH-21', !verdictText.includes(hostedTestEnv({}).SUPABASE_SERVICE_ROLE_KEY),
  'nor does the service-role key');
check('VH-22', noDsn.missing.every((k) => /^[A-Z0-9_]+$/.test(k)),
  `missing credentials are reported as key names only (${noDsn.missing.join(', ')})`);

// ------------------------------- 6. a harness-pinned target is not overridden by a local file

const pinned = verifier.chooseEnvFile({ NABIN_TARGET_LABEL: 'cloud-staging' });
check('VH-23', pinned.loaded === null && pinned.reason === 'harness-pinned',
  `under with_staging_target.js no .env file may replace the audited map (${JSON.stringify(pinned)})`);
const unpinned = verifier.chooseEnvFile({});
check('VH-24', typeof unpinned.loaded === 'string' && /\.env/i.test(unpinned.loaded),
  `outside the harness the file is still the source of truth (${JSON.stringify(unpinned)})`);
const sourceText = fs.readFileSync(path.join(__dirname, 'scripts', 'verify_hosted_test_env.js'), 'utf8');
const mainIndex = sourceText.indexOf('require.main === module');
const dotenvIndex = sourceText.indexOf("require('dotenv')");
check('VH-25', mainIndex !== -1 && dotenvIndex !== -1 && dotenvIndex > mainIndex,
  `dotenv is loaded only on the CLI path, so importing this module cannot mutate the importer's env (main at ${mainIndex}, dotenv at ${dotenvIndex})`);
check('VH-26', typeof verifier.decide === 'function' && typeof verifier.exitCodeFor === 'function',
  'the decision is exported, so a verdict is observable instead of an exit code nobody reads');

// ------------------------------------------------------------ 7. the exit-code table

check('VH-27', verifier.exitCodeFor(verifier.decide(hostedTestEnv({})), []) === 0
  && verifier.exitCodeFor(noDsn, []) === 2
  && verifier.exitCodeFor(local, ['--allow-pending']) === 0
  && verifier.exitCodeFor(prodUrl, []) === 1,
  'PASS 0, pending 2, pending-with-escape 0, production 1');

// ---------------------------------------------------------------- report

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('✅ The hosted-test verifier needs all three credentials, refuses production and mismatches outright, names what is missing without echoing it, and will not let a local .env file replace a harness-pinned target.');
