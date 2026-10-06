// =========================================================================
// ONE ENVIRONMENT, ONE PROJECT — AND NO OTHER
//
// Two hosted Supabase projects back NABIN: `ywhxkzmbwppkdemvzlhv` (nabin-test) for
// development and testing, `ouxvqmhuyueklnegvmxe` (NABIN) for production. The owner's
// rule is that a development build must not be able to connect to the production
// database, and "the operator pasted the right keys" is not a control.
//
// `src/services/nabinEnv.js` is that control, so this file pins both halves of it:
//   1. Every legitimate configuration boots — including the local Docker loopback the
//      repo uses day to day, which must not be burdened with a declaration it has no use for.
//   2. Every cross-environment shape is refused: test URL with a production pooler,
//      a hosted project with no declared owner, a production identity running with test
//      convenience switched on, and a key from one project paired with another's URL.
//
// A refusal must also name the mismatch without repeating a credential. Nothing here
// touches a network or a database; the guard is a pure function of the environment map.
// =========================================================================

const nabinEnv = require('./src/services/nabinEnv');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

const TEST_REF = 'ywhxkzmbwppkdemvzlhv';
const PROD_REF = 'ouxvqmhuyueklnegvmxe';
const ANON = `https://${TEST_REF}.supabase.co`;
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const LOCAL_JDBC = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TEST_JDBC = `postgresql://postgres:secretpw@db.${TEST_REF}.supabase.co:5432/postgres`;
const POOLER_JDBC = `postgresql://postgres.${TEST_REF}:secretpw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;

// Supabase's legacy keys are JWTs whose `iss` names the project. Only the shape matters
// here, so the signature is a literal word — and that word is what the leak assertions look for.
function jwt(role, ref) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    role, iss: ref ? `supabase:${ref}` : 'supabase', aud: 'authenticated'
  })}.SIG-${role}-${ref || 'local'}`;
}
const TEST_KEYS = {
  SUPABASE_ANON_KEY: jwt('anon', TEST_REF),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', TEST_REF),
};
const PROD_KEYS = {
  SUPABASE_ANON_KEY: jwt('anon', PROD_REF),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', PROD_REF),
};

// The configuration the repo runs on today: local Docker, no declaration, no ref.
const LOCAL_DEV = {
  NODE_ENV: 'development', SUPABASE_POSTGRES_LIVE: 'true',
  SUPABASE_URL: 'http://127.0.0.1:54321', DATABASE_URL: LOCAL_JDBC,
  SUPABASE_ANON_KEY: jwt('anon', null), SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', null),
};

const HOSTED_TESTING = {
  NODE_ENV: 'production', SUPABASE_POSTGRES_LIVE: 'true',
  NABIN_ENV: 'testing', NABIN_SUPABASE_REF: TEST_REF,
  SUPABASE_URL: ANON, DATABASE_URL: TEST_JDBC, ...TEST_KEYS,
};

const HOSTED_PRODUCTION = {
  NODE_ENV: 'production', SUPABASE_POSTGRES_LIVE: 'true',
  NABIN_ENV: 'production', NABIN_SUPABASE_REF: PROD_REF,
  SUPABASE_URL: PROD_URL, DATABASE_URL: `postgresql://postgres:secretpw@db.${PROD_REF}.supabase.co:5432/postgres`,
  ...PROD_KEYS,
};

const problemsOf = (env) => nabinEnv.audit(env).problems;
const mustRefuse = (id, env, phrase, detail) => {
  const ps = problemsOf(env);
  check(id, ps.some((p) => p.includes(phrase)), `${detail} → refused with: ${ps[0] || '(nothing!)'}`);
};
const mustAccept = (id, env, detail) => {
  const ps = problemsOf(env);
  check(id, ps.length === 0, `${detail}${ps.length ? ` — but got: ${ps.join(' | ')}` : ''}`);
};

// ---------------------------------------------------------------- 1. legitimate configs boot

mustAccept('T01', LOCAL_DEV, 'local Docker loopback needs no NABIN_ENV declaration');
mustAccept('T02', HOSTED_TESTING, 'testing pinned to the nabin-test ref');
mustAccept('T03', HOSTED_PRODUCTION, 'production pinned to the NABIN ref');
mustAccept('T04', { ...HOSTED_TESTING, DATABASE_URL: POOLER_JDBC },
  'the Supavisor shape (ref in the username, region in the host) is recognised, not refused');
mustAccept('T05', { ...LOCAL_DEV, NABIN_ENV: 'development' },
  'declaring development over loopback stays legal');
mustAccept('T05b', { ...LOCAL_DEV, NABIN_ENV: 'development', NABIN_SUPABASE_REF: TEST_REF },
  'a leftover ref declaration over loopback does not refuse the boot');
mustRefuse('T05c', { NODE_ENV: 'production', NABIN_ENV: 'production', NABIN_SUPABASE_REF: PROD_REF },
  'no hosted Supabase project is configured', 'production with nothing to talk to');

// ---------------------------------------------------------------- 2. cross-environment shapes refused

mustRefuse('T06', { ...HOSTED_TESTING, DATABASE_URL: `postgresql://postgres:p@db.${PROD_REF}.supabase.co:5432/postgres` },
  PROD_REF, 'test REST URL paired with the production pooler');
mustRefuse('T07', { ...HOSTED_TESTING, NABIN_SUPABASE_REF: PROD_REF },
  ANON, 'the pin disagrees with every URL');
mustRefuse('T08', { NODE_ENV: 'production', SUPABASE_URL: ANON, DATABASE_URL: TEST_JDBC, ...TEST_KEYS },
  'No NABIN_ENV declared', 'a hosted project with no environment named');
mustRefuse('T09', { NODE_ENV: 'production', SUPABASE_URL: ANON, DATABASE_URL: TEST_JDBC, NABIN_ENV: 'testing', ...TEST_KEYS },
  'NABIN_SUPABASE_REF', 'an environment that names itself but not its project');
mustRefuse('T10', { ...HOSTED_PRODUCTION, NABIN_ENV: 'production', SUPABASE_URL: ANON, DATABASE_URL: TEST_JDBC },
  PROD_REF, 'production project reached through test URLs');
mustRefuse('T11', { ...HOSTED_TESTING, NABIN_ENV: 'production', NABIN_SUPABASE_REF: TEST_REF, NODE_ENV: 'development' },
  'NODE_ENV="development"', 'production identity while test convenience is still allowed');
mustRefuse('T12', { ...HOSTED_TESTING, NABIN_ENV: 'staging' },
  'NABIN_ENV="staging"', 'an invented environment name');
mustRefuse('T13', { ...HOSTED_TESTING, NABIN_SUPABASE_REF: 'not-a-ref' },
  'not a 20-character', 'a malformed ref declaration');
mustRefuse('T14', { ...HOSTED_PRODUCTION, NODE_ENV: 'production', SUPABASE_URL: 'http://127.0.0.1:54321' },
  'loopback host', 'production pointing at a local container');

// ---------------------------------------------------------------- 3. credentials

mustRefuse('T15', { ...HOSTED_TESTING, SUPABASE_SERVICE_ROLE_KEY: PROD_KEYS.SUPABASE_SERVICE_ROLE_KEY },
  'Cross-environment credential', 'the production service key in a testing deployment');
mustRefuse('T16', { ...HOSTED_TESTING, SUPABASE_ANON_KEY: PROD_KEYS.SUPABASE_ANON_KEY },
  'Cross-environment credential', 'the production anon key in a testing deployment');
mustRefuse('T17', { ...HOSTED_TESTING, SUPABASE_ANON_KEY: TEST_KEYS.SUPABASE_SERVICE_ROLE_KEY },
  'holds a service_role key', 'a service-role credential in the anon slot a client would read');
mustRefuse('T18', { ...HOSTED_PRODUCTION, SUPABASE_SERVICE_ROLE_KEY: '' },
  'no SUPABASE_SERVICE_ROLE_KEY', 'production would silently run the admin client as anon');
mustAccept('T19', { ...HOSTED_TESTING, SUPABASE_ANON_KEY: 'sb_publishable_AAAA-BBBB_CCCC' },
  'a publishable anon key carries no project claim, so only the pin applies to it');

// ---------------------------------------------------------------- 4. refusal wording

const thrown = (() => {
  try {
    nabinEnv.assertConfigured({ ...HOSTED_TESTING, SUPABASE_SERVICE_ROLE_KEY: PROD_KEYS.SUPABASE_SERVICE_ROLE_KEY });
    return null;
  } catch (err) {
    return err;
  }
})();
check('T20', thrown && thrown.code === 'NABIN_ENV_MISMATCH', 'assertConfigured throws a typed error');
check('T21', thrown && [TEST_KEYS.SUPABASE_ANON_KEY, PROD_KEYS.SUPABASE_SERVICE_ROLE_KEY, 'secretpw']
  .every((secret) => !thrown.message.includes(secret)),
  'the message names refs and slots but repeats no key or password');
check('T22', nabinEnv.assertConfigured(HOSTED_PRODUCTION).view.production === true,
  'the clean path returns the resolved view instead of throwing');

// ---------------------------------------------------------------- 5. ref extraction is not naive

check('T23', nabinEnv.projectRefs(`postgresql://postgres.${TEST_REF}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`)
  .refs.join() === TEST_REF, 'pooler: ref read from the username');
check('T24', nabinEnv.projectRefs(`https://${TEST_REF}.supabase.co`).refs.join() === TEST_REF,
  'REST: ref read from the host');
check('T25', nabinEnv.projectRefs(LOCAL_JDBC).local === true && nabinEnv.projectRefs(LOCAL_JDBC).refs.length === 0,
  'loopback: no ref invented');
check('T26', nabinEnv.projectRefs('postgresql://postgres:abcdefghijklmnopqrst@127.0.0.1:54322/postgres')
  .refs.length === 0, 'a 20-character lowercase password is not read as a project ref');
const pwEnv = {
  NODE_ENV: 'production', SUPABASE_URL: ANON, NABIN_ENV: 'testing', NABIN_SUPABASE_REF: TEST_REF,
  DATABASE_URL: `postgresql://postgres:abcdefghijklmnopqrst@db.${TEST_REF}.supabase.co:5432/postgres`,
  ...TEST_KEYS,
};
check('T27', problemsOf(pwEnv).length === 0,
  `a password that looks like a ref does not produce a phantom mismatch (${problemsOf(pwEnv).join(' | ') || 'clean'})`);

// ---------------------------------------------------------------- report

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('✅ NABIN environment guard holds: every legitimate configuration boots and every cross-environment shape is refused.');
