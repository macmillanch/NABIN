// =========================================================================
// ONE PROJECT PER ENVIRONMENT
//
// Two hosted Supabase projects exist for NABIN: `ywhxkzmbwppkdemvzlhv`
// (nabin-test, development and testing) and `ouxvqmhuyueklnegvmxe` (NABIN,
// production). The rule that makes them safe is not "remember to put the right
// keys in the right `.env`" — it is "a process that names one environment
// cannot start against the other project's database".
//
// So a deployment declares two things and this file holds it to them:
//   NABIN_ENV           development | testing | production
//   NABIN_SUPABASE_REF  the single project ref that environment owns
// Every hosted ref the process can actually reach — the REST URL, the Postgres
// connection string, the project encoded in each Supabase key — has to equal
// that declaration, or the boot fails with the mismatch spelled out.
//
// Local Docker Supabase (loopback) needs no declaration and stays untouched: a
// guard that breaks the offline dev loop is a guard people route around.
//
// Same shape as `RuntimeMode.js`: a mis-set variable may only ever close a door
// further, never widen one. Nothing in this file can enable a convenience, and
// reading it should never print a credential — refs are public identifiers,
// keys are not, so only claims and mismatches are echoed.
// =========================================================================

const REF_PATTERN = /^[a-z0-9]{20}$/;
const ENVIRONMENTS = ['development', 'testing', 'production'];
const PRODUCTION_ENV = 'production';

// Anything that resolves here is the developer's own machine, not a hosted project.
const LOCAL_HOST_PATTERN = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|0\.0\.0\.0|host\.docker\.internal|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/i;

function isLocalHost(host) {
  return LOCAL_HOST_PATTERN.test(String(host || ''));
}

/**
 * The project refs a connection string can name.
 *
 * A hosted project is addressable three ways and all three show up in real config:
 *   https://<ref>.supabase.co                                  (REST / auth)
 *   postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/...   (direct)
 *   postgresql://postgres.<ref>:<pw>@aws-0-…pooler.supabase.com:6543/... (pooler,
 *     ref in the *username*, region in the hostname)
 * The password is deliberately excluded from the scan: a 20-character lowercase
 * secret would otherwise read as a project ref and produce a mismatch nobody has.
 */
function projectRefs(raw) {
  const value = String(raw || '').trim();
  if (!value) return { present: false, local: false, hosted: false, refs: [], host: null };

  let url = null;
  try {
    url = new URL(value);
  } catch (e) {
    // Not a URL we can parse. Scan the whole string rather than assume the operator
    // wrote it in one of the three shapes above — a ref in a malformed string is still
    // a ref, and "unparseable" is not a licence to skip the check.
    const refs = value.split(/[@.:/?&=]/).filter((p) => REF_PATTERN.test(p));
    return {
      present: true,
      local: false,
      hosted: refs.length > 0,
      refs: [...new Set(refs)],
      host: null,
      unparseable: true,
    };
  }

  const host = (url.hostname || '').toLowerCase();
  const scanned = [host, url.pathname];
  try {
    scanned.push(decodeURIComponent(url.username || ''));
  } catch (e) {
    scanned.push(url.username || '');
  }
  const refs = scanned
    .join(' ')
    .split(/[@.:/?&=]/)
    .filter((p) => REF_PATTERN.test(p));

  return {
    present: true,
    local: isLocalHost(host),
    hosted: !isLocalHost(host),
    refs: [...new Set(refs)],
    host,
  };
}

/**
 * What a Supabase key says about the project it belongs to.
 *
 * Legacy `anon` / `service_role` keys are JWTs carrying `iss: "supabase:<ref>"` and a
 * `role` claim, so the key itself can be checked against the URL it is paired with —
 * which is exactly the "development URL, production key" accident. The newer
 * `sb_publishable_…` / `sb_secret_…` formats carry no project claim; for those the
 * declared ref is the only control, and that is stated as a note, not a failure.
 *
 * The token is never included in any output this function produces.
 */
function keyClaims(raw) {
  const token = String(raw || '').trim();
  if (!token) return { present: false };
  if (token.startsWith('sb_publishable_')) return { present: true, format: 'publishable' };
  if (token.startsWith('sb_secret_')) return { present: true, format: 'secret' };
  const parts = token.split('.');
  if (parts.length !== 3) return { present: true, format: 'opaque' };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const iss = String(payload.iss || '');
    const fromIss = iss.split(':').pop();
    return {
      present: true,
      format: 'jwt',
      role: String(payload.role || ''),
      ref: REF_PATTERN.test(fromIss) ? fromIss.toLowerCase() : null,
    };
  } catch (e) {
    return { present: true, format: 'opaque' };
  }
}

/**
 * Compare the declared environment with everything the process can reach.
 *
 * Returns `{ problems, notes, view }` and never throws, so both a boot guard and a
 * read-only `--check` command can share one derivation of the truth.
 */
function audit(source) {
  const env = source || process.env;
  const problems = [];
  const notes = [];

  const name = String(env.NABIN_ENV || '').trim().toLowerCase();
  const pin = String(env.NABIN_SUPABASE_REF || '').trim().toLowerCase();
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();

  const rest = projectRefs(env.SUPABASE_URL);
  const jdbc = projectRefs(env.DATABASE_URL);
  const observed = [...new Set([...rest.refs, ...jdbc.refs])];

  if (name && !ENVIRONMENTS.includes(name)) {
    problems.push(
      `NABIN_ENV="${name}" is not one of ${ENVIRONMENTS.join(' | ')}.`
    );
  }
  if (pin && !REF_PATTERN.test(pin)) {
    problems.push(
      `NABIN_SUPABASE_REF="${pin}" is not a 20-character Supabase project ref.`
    );
  }

  // Test convenience is decided by NODE_ENV in `RuntimeMode.js`, so an environment that
  // claims production data while running under NODE_ENV=development would answer a fixed
  // OTP against the production project. Production identity therefore requires production
  // hardening; the reverse (beta running hardened) is fine and is how beta is deployed.
  if (name === PRODUCTION_ENV && nodeEnv && nodeEnv !== PRODUCTION_ENV) {
    problems.push(
      `NABIN_ENV=production with NODE_ENV="${nodeEnv}" — this process would serve the `
      + 'production project while still allowing test convenience (fixed OTP codes, `NABIN_TEST_MODE`). '
      + 'Set NODE_ENV=production.'
    );
  }

  // Production with no hosted store is a misconfiguration; production on a loopback host
  // is the same mistake wearing a dev `.env`.
  const reachesHosted = observed.length > 0 || rest.hosted || jdbc.hosted;
  if (name === PRODUCTION_ENV && !reachesHosted) {
    problems.push(
      'NABIN_ENV=production while no hosted Supabase project is configured. A production '
      + 'environment that resolves to nothing would serve live traffic from the in-memory mock store.'
    );
  }

  // The declarations are only demanded of a process that can actually reach a hosted
  // project. `NABIN_ENV=development` on the local Docker stack is legitimate and stays
  // as light as it was before this file existed.
  if (reachesHosted) {
    if (!name) {
      problems.push(
        'No NABIN_ENV declared while a hosted Supabase project is configured. Name the '
        + 'environment (development | testing | production) so this process can be checked against it.'
      );
    }
    if (!pin) {
      problems.push(
        `NABIN_ENV="${name || 'undeclared'}" reaches the hosted project(s) ${observed.join(', ') || '(none named in the URLs)'} `
        + 'but does not declare NABIN_SUPABASE_REF — the one project this environment is allowed to use.'
      );
    }
    for (const ref of observed) {
      if (pin && ref !== pin) {
        const where = [
          rest.refs.includes(ref) ? `SUPABASE_URL (${env.SUPABASE_URL})` : null,
          jdbc.refs.includes(ref) ? 'DATABASE_URL' : null,
        ].filter(Boolean).join(' and ');
        problems.push(
          `${where} points at project ${ref} but this environment declares NABIN_SUPABASE_REF=${pin}.`
        );
      }
    }
    // A hosted target with no ref in it is a proxy or a typo; either way the pin cannot be
    // verified, so it is not allowed to pass silently.
    if (rest.hosted && rest.refs.length === 0 && !rest.unparseable) {
      problems.push(
        `SUPABASE_URL="${env.SUPABASE_URL}" is a hosted host with no project ref in it, `
        + `so it cannot be checked against NABIN_SUPABASE_REF=${pin || '(undeclared)'}${pin ? '' : '.'}`
      );
    }
    if (name === PRODUCTION_ENV && rest.local) {
      problems.push('NABIN_ENV=production while SUPABASE_URL is a loopback host.');
    }
  }

  // Keys: project match, then role match. A service key in the anon slot is the shape a
  // client-visible credential takes; an anon key in the service slot is how a privileged
  // write silently becomes a 401 in production.
  const expectRef = pin || observed[0] || null;
  const anon = keyClaims(env.SUPABASE_ANON_KEY);
  const service = keyClaims(env.SUPABASE_SERVICE_ROLE_KEY);
  const slotOf = (label, claims) => {
    if (!claims.present) return;
    if (claims.ref && expectRef && claims.ref !== expectRef) {
      problems.push(
        `${label} is a key for project ${claims.ref} but this environment uses `
        + `${expectRef}. Cross-environment credential — refusing to start.`
      );
    }
    if (!claims.ref && claims.format !== 'jwt' && expectRef) {
      notes.push(
        `${label} is a ${claims.format} key, which carries no project claim; the `
        + `NABIN_SUPABASE_REF pin is the only guard on it.`
      );
    }
  };
  slotOf('SUPABASE_ANON_KEY', anon);
  slotOf('SUPABASE_SERVICE_ROLE_KEY', service);
  if (service.present && service.role && service.role !== 'service_role') {
    problems.push(
      `SUPABASE_SERVICE_ROLE_KEY holds a "${service.role}" key. The server-side admin `
      + 'client needs the service_role key.'
    );
  }
  if (anon.present && anon.role === 'service_role') {
    problems.push(
      'SUPABASE_ANON_KEY holds a service_role key. That credential must never be the '
      + 'one a client or an unauthenticated path is handed.'
    );
  }
  if (name === PRODUCTION_ENV && !service.present) {
    problems.push(
      'NABIN_ENV=production with no SUPABASE_SERVICE_ROLE_KEY configured. Privileged '
      + 'writes would otherwise fall back to the anon key and half-succeed.'
    );
  }

  return {
    problems,
    notes,
    view: {
      env: name || 'undeclared',
      nodeEnv: nodeEnv || 'unset',
      declaredRef: pin || null,
      observedRefs: observed,
      restLocal: rest.local,
      restHost: rest.host,
      production: name === PRODUCTION_ENV,
    },
  };
}

/**
 * The startup gate. Fails closed and prints every problem at once, because an operator
 * who fixes one mismatch and reboots to find a second learns to distrust the guard.
 */
function assertConfigured(source) {
  const a = audit(source);
  if (a.problems.length) {
    const msg = [
      'NABIN environment configuration refused to start:',
      ...a.problems.map((p) => `  - ${p}`),
      `  Declared: NABIN_ENV=${a.view.env || '(none)'} NABIN_SUPABASE_REF=${a.view.declaredRef || '(none)'} `
      + `NODE_ENV=${a.view.nodeEnv}`,
      '  See docs/SUPABASE_ENVIRONMENTS.md for which ref belongs to which environment.',
    ].join('\n');
    const err = new Error(msg);
    err.code = 'NABIN_ENV_MISMATCH';
    err.problems = a.problems;
    throw err;
  }
  return a;
}

function isProductionEnv(source) {
  return String((source || process.env).NABIN_ENV || '').trim().toLowerCase() === PRODUCTION_ENV;
}

module.exports = { ENVIRONMENTS, PRODUCTION_ENV, audit, assertConfigured, isProductionEnv, projectRefs, keyClaims };
