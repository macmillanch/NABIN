/*
 * Read-only store census, and the independent before/after guard for the residue question.
 *
 * `chain_scratch.js` guards a curated list of protected table names. A curated list cannot answer
 * "what else moved?", so this file counts EVERY base table in one schema (discovered from
 * information_schema, never hardcoded), plus the row-level facts a count cannot see: how many
 * orders carry each fixture marker, and the qr token stored on each floor table. Two runs then diff
 * mechanically instead of being compared by eye.
 *
 * #329 closed the loop between the two: this file reads the hard guard's own list out of
 * `scripts/protected_tables.js` and tags every drift line `[protected]` or `[UNPROTECTED]`, so a
 * table that moves and is not covered is reported as uncovered rather than being silently absent
 * from a list somebody maintains by hand.
 *
 * Modes:
 *   count    [schema]                 print `schema.table=count` lines (default schema: public)
 *   snapshot [schema] [--out FILE]    print the same lines and write the machine copy to FILE
 *   compare  [schema] --ref FILE      print `DRIFT` lines tagged `[protected]` or `[UNPROTECTED]`; exit 1
 *                                     when anything changed (or a table appeared/disappeared) unless
 *                                     --report-only
 *   selftest [--keep]                 prove every #329 obligation table is counted when one row lands in
 *                                     it, that an uncovered table reports as UNPROTECTED, and (F-C1-2)
 *                                     that a zero-row schema IS a measurement while four unmeasurable
 *                                     shapes refuse - against disposable `nabin_census_guardprobe`,
 *                                     `nabin_census_probe_unguarded`, `nabin_census_probe_absent` and
 *                                     `nabin_census_probe_case5` schemas only, never `public`
 *
 * Fail-closed rules, in this order: refuse `NODE_ENV=production`; refuse a PostgreSQL target that is
 * not DECLARED (F-C1-1 — this file used to fall back to a hardcoded loopback DSN and count a store no
 * configuration named); refuse a non-loopback or production target; refuse a schema that cannot be
 * measured (F-C1-2 — it does not exist, holds no base tables, contains none of the guarded table
 * names, or lacks a table named by `--required`), because an empty census otherwise prints
 * `CENSUS CLEAN: 0 census line(s) unchanged` at exit 0; refuse to WRITE anything in
 * `count`/`snapshot`/`compare`; and in `selftest`, refuse if the probe schema already exists (it
 * belongs to an earlier run that did not clean up) and refuse the name `public` as a probe target. A
 * read the database refuses is a failed run, not a skipped one. An existing table holding zero rows is
 * a MEASUREMENT, not a refusal: the checks above are about tables, never about row counts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const child = require('child_process');
const { Client } = require('pg');
const { PROTECTED, APPEND_PROBED, DETECTION_OBLIGATIONS, tableOf, isCovered } = require('./protected_tables');
const targetGuard = require('./chain_target_guard');
const censusVerdict = require('./census_verdict');

const PROBE_SCHEMA = 'nabin_census_guardprobe';
// A table no guard list knows about, created inside the disposable schema. It exists so the probe can
// show what an UNCOVERED mover looks like without inventing a name that is not in `public`.
const UNCOVERED_PROBE = 'nabin_guard_probe_uncovered';
const IDENT = /^[a-z_][a-z0-9_]*$/i;

// The names both guards are responsible for: the exact-count list plus the append-probed
// accumulators. A schema holding none of these is a schema neither guard can measure.
const GUARDED_NAMES = [...new Set([...PROTECTED, ...APPEND_PROBED.map((p) => p.table)])];

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : (argv.includes('selftest') ? 'selftest' : 'count');
const positional = argv.filter((a) => !a.startsWith('--') && a !== mode);
const SCHEMA = positional[0] || 'public';
const flag = (name) => argv.indexOf(`--${name}`) !== -1;
const value = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

// F-C1-2: a census can name tables it refuses to run without. `--required=orders,payments` makes a
// schema that lacks them a REFUSAL instead of a short file that compares CLEAN, which is how the
// "missing required table" case is executable rather than described.
const REQUIRED = (value('required', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
REQUIRED.forEach((t) => assertIdent(t, 'required table'));

function assertIdent(name, what) {
  if (!IDENT.test(name)) throw new Error(`census: refusing ${what} ${JSON.stringify(name)}`);
}

// `name=value`, split on the FIRST separator only. The QR-token lines carry a base64 value, and its
// `=` padding is part of the token: `l.split('=')[1]` truncated `abc==` to `abc`, so two different
// tokens that share the prefix before the padding compared equal and a changed token could pass as
// unchanged. Every name the census emits is schema/table/marker and contains no `=`, so the first
// separator is always the boundary.
function parseCensusLine(line) {
  const i = line.indexOf('=');
  if (i === -1) throw new Error(`census: refusing to parse line ${JSON.stringify(line)} (no '=' separator)`);
  return [line.slice(0, i), line.slice(i + 1)];
}

async function main() {
  assertIdent(SCHEMA, 'schema');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('census REFUSED: NODE_ENV=production');
  }
  // F-C1-1: the target must be DECLARED. Precedence is the chain guard's own (shell first, then the env
  // file the children load), so the census counts the store the links actually reach instead of a
  // private guess. Measured 2026-10-16: with DATABASE_URL unset and no wrapper, `count public` exited 0
  // having counted 74 lines from a DSN hardcoded below - a store no configuration named. Nothing here
  // is printed but host, port and database, because the URL carries a password.
  const target = targetGuard.requireLoopbackPgTarget({ label: 'census' });
  // On stderr, so this line cannot be harvested as a census line by the runner's `^public\.` filter.
  console.error(`# census target: ${target.source} -> ${target.host}:${target.port}/${target.database} | schema ${SCHEMA}`);

  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    if (mode === 'selftest') return await selftest(client);
    if (mode === 'count' || mode === 'snapshot') {
      const { lines, measurable } = await census(client, SCHEMA);
      console.log(lines.join('\n'));
      if (mode === 'snapshot') {
        const out = value('out', path.join('scratch', `census_${SCHEMA}.json`));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify({
          takenAt: new Date().toISOString(), schema: SCHEMA,
          // F-C1-2: record WHAT was measured, not only the numbers. A baseline that says how many
          // guarded tables it counted lets `compare` refuse a baseline that measured nothing, instead
          // of iterating an empty object and printing CLEAN.
          guardedTablesPresent: measurable.guardedPresent,
          requiredTables: REQUIRED,
          lines, counts: Object.fromEntries(lines.map(parseCensusLine)),
        }, null, 2) + '\n', 'utf8');
        console.error(`# snapshot: ${lines.length} census line(s) over ${measurable.guardedPresent} guarded table(s) -> ${out}`);
      }
      return;
    }
    if (mode === 'compare') {
      const ref = value('ref', null);
      if (!ref) throw new Error('compare needs --ref <snapshot file written by snapshot>');
      const prev = JSON.parse(fs.readFileSync(ref, 'utf8'));
      if (prev.schema !== SCHEMA) {
        throw new Error(`compare: --ref was taken against schema ${prev.schema}, not ${SCHEMA}`);
      }
      // The refusal the snapshot path applies, read from the other side: a baseline with no counts
      // leaves `keys` holding only what the current census produced, and a matching current census then
      // prints "0 census line(s) changed" - the CLEAN verdict of a guard that compared nothing.
      if (!prev.counts || typeof prev.counts !== 'object' || Array.isArray(prev.counts)
        || !Object.keys(prev.counts).length) {
        throw new Error(`census REFUSED: --ref ${ref} carries no counts baseline `
          + '(field missing or empty) — compare would measure nothing and report CLEAN');
      }
      const { lines, measurable } = await census(client, SCHEMA);
      if (prev.guardedTablesPresent !== undefined
        && prev.guardedTablesPresent !== measurable.guardedPresent) {
        // Guarded tables leaving the schema between baseline and compare is a different movement from a
        // row count: the guarded SET changed, so the two halves are not comparable.
        throw new Error(`census REFUSED: ${SCHEMA} held ${prev.guardedTablesPresent} guarded table(s) at the `
          + `baseline and ${measurable.guardedPresent} now — the guarded set itself moved, so no CLEAN `
          + 'verdict is meaningful');
      }
      const now = Object.fromEntries(lines.map(parseCensusLine));
      const keys = Array.from(new Set([...Object.keys(prev.counts), ...Object.keys(now)])).sort();
      const drift = [];
      const uncovered = [];
      for (const k of keys) {
        const b = prev.counts[k], a = now[k];
        let line = null;
        if (b === undefined) { line = `${k}: ABSENT -> ${a} (appeared)`; }
        else if (a === undefined) { line = `${k}: ${b} -> ABSENT (disappeared)`; }
        else if (b !== a) { line = `${k}: ${b} -> ${a}`; }
        if (!line) continue;
        // #329: name the coverage status on the line itself. Without this, a reader had to know the
        // protected list to tell "a table the hard guard refuses an isolated link for" apart from
        // "a table nobody has guarded yet" - and a silently-omitted mover is the failure mode this
        // change exists to remove.
        if (isCovered(k)) line += ' [protected]';
        else { line += ' [UNPROTECTED - add it to scripts/protected_tables.js]'; uncovered.push(tableOf(k)); }
        drift.push(line);
      }
      for (const line of drift) console.log(`DRIFT ${line}`);
      if (!drift.length) {
        console.log(`CENSUS CLEAN: ${keys.length} census line(s) unchanged against ${ref} `
          + `(${measurable.guardedPresent} guarded table(s) measured`
          + `${REQUIRED.length ? `, --required ${REQUIRED.join(',')}` : ''})`);
        return;
      }
      if (uncovered.length) {
        console.log(`UNPROTECTED MOVERS: ${uncovered.join(', ')} - the hard guard in `
          + `scripts/chain_scratch.js cannot see these tables, so an isolated link writing them would not fail the link`);
      }
      console.error(`${drift.length} census line(s) changed since ${ref}`);
      if (!flag('report-only')) process.exitCode = 1;
      return;
    }
    throw new Error(`unknown mode ${mode} (count|snapshot|compare|selftest)`);
  } finally {
    await client.end();
  }
}

/**
 * F-C1-2: prove the census is about to MEASURE something, before it emits an empty result that reads as
 * a pass.
 *
 * Measured 2026-10-16: a census aimed at a schema that does not exist wrote `"counts": {}` at exit 0 and
 * compared as `CENSUS CLEAN: 0 census line(s) unchanged` at exit 0, while `chain_scratch` on the same
 * name exits 1 with `guard REFUSED: no protected table exists`. Same false-green class, reached from the
 * other guard. All four checks below are about TABLES: a valid schema whose guarded tables all hold zero
 * rows still measures and still exits 0, because zero rows is a fact about the store while an absent
 * schema is a fact about the invocation.
 */
async function assertMeasurable(client, schema, baseTableRows, required = REQUIRED) {
  const names = baseTableRows.map((r) => r.tablename);
  const schemaExists = (await client.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name=$1`, [schema])).rowCount;
  if (!schemaExists) {
    throw new Error(`census REFUSED: schema ${JSON.stringify(schema)} does not exist in this database - `
      + 'the census would write an empty file and compare as CLEAN. A typo here is indistinguishable '
      + 'from an empty store unless the schema itself is checked.');
  }
  if (!names.length) {
    throw new Error(`census REFUSED: schema ${schema} exists but holds no base tables - nothing to count, `
      + 'so a CLEAN verdict would describe an absence rather than a measurement');
  }
  const guardedPresent = names.filter((n) => GUARDED_NAMES.includes(n));
  if (!guardedPresent.length) {
    throw new Error(`census REFUSED: none of the ${GUARDED_NAMES.length} guarded table names exists in `
      + `${schema} - the census would count tables no guard is responsible for and report CLEAN`);
  }
  const absent = required.filter((t) => !names.includes(t));
  if (absent.length) {
    throw new Error(`census REFUSED: --required table(s) ${absent.join(', ')} absent from ${schema} - `
      + 'a census that cannot count a table it declared required has not measured what it claimed');
  }
  return { guardedPresent: guardedPresent.length, guardedNames: guardedPresent };
}

// Every base table in the schema, exact counts, plus the row-level facts a count cannot see.
async function baseTables(client, schema) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename NOT LIKE 'pg_%' ORDER BY 1`, [schema]);
  return rows;
}

async function census(client, schema) {
  const rows = await baseTables(client, schema);
  const measurable = await assertMeasurable(client, schema, rows);
  const lines = [];
  for (const { tablename } of rows) {
    assertIdent(tablename, 'table');
    const n = (await client.query(`SELECT count(*)::bigint n FROM ${schema}.${tablename}`)).rows[0].n;
    lines.push(`${schema}.${tablename}=${n}`);
  }
  const has = (t) => rows.some((r) => r.tablename === t);
  if (has('orders')) {
    for (const prefix of ['RMSSPEC-', 'E2E-', 'FIX-', 'ORD-']) {
      const n = (await client.query(
        `SELECT count(*)::bigint n FROM ${schema}.orders WHERE order_number LIKE $1`, [`${prefix}%`])).rows[0].n;
      lines.push(`${schema}.orders[${prefix}*]=${n}`);
    }
  }
  if (has('restaurant_tables')) {
    const trows = (await client.query(
      `SELECT table_number, qr_code_token FROM ${schema}.restaurant_tables ORDER BY 1`)).rows;
    for (const r of trows) lines.push(`${schema}.restaurant_tables[${r.table_number}].qr=${r.qr_code_token}`);
  }
  return { lines, measurable };
}

// The guard proof: a write the census MUST see, executed against a throwaway schema and cleaned up
// in the same run. `public` is only ever read (for the table definitions and one row per table) and
// never written.
//
// The obligation list is the #329 additions plus `products`, which the probe has always proven. Each
// one is a table the census must report as moved when a single row lands in it, and each is proven
// individually - a pass that only says "something changed" would still pass if nine of the ten were
// invisible to the count.
async function selftest(client) {
  const exists = (await client.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name=$1`, [PROBE_SCHEMA])).rowCount;
  if (exists) {
    throw new Error(`selftest REFUSED: schema ${PROBE_SCHEMA} already exists - an earlier probe did not `
      + 'clean up. Drop it by name after checking what is in it, then re-run.');
  }
  const publicTables = (await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map((r) => r.tablename);
  const obligations = ['products', ...DETECTION_OBLIGATIONS];
  const absent = obligations.filter((t) => !publicTables.includes(t));
  if (absent.length) {
    throw new Error(`selftest: ${absent.join(', ')} is named as a #329 obligation but is not a table in public `
      + '- the protected list and the store have diverged, fix scripts/protected_tables.js first');
  }

  console.log(`selftest: target=${PROBE_SCHEMA} (disposable; public is read for definitions and one row per table only)`);
  await client.query(`CREATE SCHEMA ${PROBE_SCHEMA}`);
  try {
    for (const t of obligations) {
      assertIdent(t, 'table');
      await client.query(`CREATE TABLE ${PROBE_SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
    }
    await client.query(`CREATE TABLE ${PROBE_SCHEMA}.${UNCOVERED_PROBE} (id bigint)`);
    const zeroCensus = await census(client, PROBE_SCHEMA);
    const before = Object.fromEntries(zeroCensus.lines.map(parseCensusLine));
    const zeroLines = zeroCensus.lines.filter((l) => /=0$/.test(l)).length;
    if (zeroLines !== zeroCensus.lines.length || !zeroCensus.measurable.guardedPresent) {
      throw new Error(`selftest FAILED: a freshly created ${PROBE_SCHEMA} should count every table at 0 `
        + `and hold at least one guarded name (got ${zeroLines}/${zeroCensus.lines.length} zero lines, `
        + `${zeroCensus.measurable.guardedPresent} guarded)`);
    }
    console.log(`  zero-row schema IS a measurement: ${zeroCensus.lines.length} census line(s), every one =0, `
      + `${zeroCensus.measurable.guardedPresent} guarded table(s) present (no refusal, because empty tables are a fact `
      + 'about the store while an absent schema is a fact about the invocation)');

    // ---- F-C1-2: the shapes that are NOT a measurement must refuse, not read as CLEAN.
    //
    // Measured 2026-10-16, before these checks existed: aimed at a schema that does not exist, this file
    // printed nothing, wrote `"counts": {}` at exit 0, and compared as `CENSUS CLEAN: 0 census line(s)
    // unchanged` at exit 0 — while `chain_scratch.js` on the same name exits 1 with `guard REFUSED: no
    // protected table exists`. A typo in the schema argument was therefore indistinguishable from an
    // untouched store, which is the whole residue question answered by a guard that measured nothing.
    const UNGUARDED_SCHEMA = 'nabin_census_probe_unguarded';
    const MISSING_SCHEMA = 'nabin_census_probe_absent';
    const CASE5_SCHEMA = 'nabin_census_probe_case5';
    const refused = [];
    const expectRefusal = async (what, fn, pattern) => {
      let message = '<no throw: the census produced a verdict for something it must refuse>';
      try { await fn(); } catch (e) { message = e.message; }
      if (!pattern.test(message)) {
        throw new Error(`selftest FAILED: ${what} did not refuse with ${pattern} -> ${message.slice(0, 200)}`);
      }
      refused.push(`${what}: ${message.split(/\r?\n/)[0].slice(0, 88)}`);
    };

    await expectRefusal('nonexistent schema', () => census(client, MISSING_SCHEMA),
      /census REFUSED: schema .* does not exist/);

    await client.query(`CREATE SCHEMA ${UNGUARDED_SCHEMA}`);
    await client.query(`CREATE TABLE ${UNGUARDED_SCHEMA}.${UNCOVERED_PROBE} (id bigint)`);
    await expectRefusal('schema with no guarded table name', () => census(client, UNGUARDED_SCHEMA),
      /census REFUSED: none of the \d+ guarded table names exists/);

    const notInProbe = PROTECTED.find((t) => !obligations.includes(t) && publicTables.includes(t));
    if (!notInProbe) {
      throw new Error(`selftest: no protected public table is absent from ${PROBE_SCHEMA}, so the `
        + '--required refusal cannot be proven here without dropping a table');
    }
    const probeBaseTables = await baseTables(client, PROBE_SCHEMA);
    await expectRefusal(`--required ${notInProbe} absent`,
      () => assertMeasurable(client, PROBE_SCHEMA, probeBaseTables, [notInProbe]),
      new RegExp(`census REFUSED: --required table\\(s\\) ${notInProbe} absent`));

    // ---- F-C1-2 case 5: a real baseline followed by a compare that CANNOT measure.
    //
    // The runner scores the census through scripts/census_verdict.js, where a nonzero compare with no
    // verdict line is `unavailable` and therefore a run problem (F-10). That classification only helps
    // if the census CLI actually exits nonzero when its baseline schema has gone; a schema-level refusal
    // swallowed at exit 0 would reach the verdict as a silent "no DRIFT line" case instead. So this runs
    // the real CLI twice against a disposable schema and hands the child result to the real verdict.
    const case5Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'census-case5-'));
    const case5Ref = path.join(case5Dir, 'snapshot.json');
    try {
      await client.query(`CREATE SCHEMA ${CASE5_SCHEMA}`);
      await client.query(`CREATE TABLE ${CASE5_SCHEMA}.${obligations[0]} (LIKE public.${obligations[0]} INCLUDING ALL)`);
      // The child inherits this process's target, so the CLI resolves the same store the selftest is
      // connected to — that is the point: the refusal has to come from the shipped argument path.
      const runCli = (args) => child.spawnSync(process.execPath, [__filename, ...args],
        { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env }, maxBuffer: 32 * 1024 * 1024 });
      const snap5 = runCli(['snapshot', CASE5_SCHEMA, '--out', case5Ref]);
      if (snap5.status !== 0) {
        throw new Error(`selftest FAILED: case 5 baseline snapshot exited ${snap5.status}: `
          + `${`${snap5.stderr}${snap5.stdout}`.split(/\r?\n/).filter(Boolean)[0] || '(no output)'}`);
      }
      await client.query(`DROP SCHEMA ${CASE5_SCHEMA} CASCADE`);
      const cmp5 = runCli(['compare', CASE5_SCHEMA, '--ref', case5Ref]);
      const cmp5Text = `${cmp5.stdout}${cmp5.stderr}`;
      if (cmp5.status === 0 || !/census REFUSED/.test(cmp5Text)) {
        throw new Error(`selftest FAILED: a compare whose schema vanished exited ${cmp5.status} instead of `
          + `refusing: ${cmp5Text.split(/\r?\n/).filter(Boolean)[0] || '(no output)'}`);
      }
      const cls5 = censusVerdict.compareOutcome(cmp5, (t) => `${t}`.split(/\r?\n/)[0] || 'no output');
      if (cls5.ok !== false || cls5.state !== 'unavailable') {
        throw new Error(`selftest FAILED: census_verdict scored the failed compare as ${cls5.state}/ok=${cls5.ok} `
          + 'instead of unavailable, so an unmeasured post-run census could still read as clean');
      }
      refused.push(`good baseline + vanished schema: CLI exit=${cmp5.status}, verdict state=${cls5.state} `
        + `(the runner counts that as a run problem, so the run cannot print 0 problem(s))`);
    } finally {
      for (const s of [UNGUARDED_SCHEMA, CASE5_SCHEMA]) await client.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
      fs.rmSync(case5Dir, { recursive: true, force: true });
      for (const s of [UNGUARDED_SCHEMA, CASE5_SCHEMA]) {
        const still = (await client.query(
          `SELECT 1 FROM information_schema.schemata WHERE schema_name=$1`, [s])).rowCount;
        if (still) throw new Error(`selftest FAILED: ${s} still present after DROP SCHEMA`);
      }
      console.log(`  teardown: DROP SCHEMA ${UNGUARDED_SCHEMA}, ${CASE5_SCHEMA} CASCADE, confirmed absent; `
        + `${case5Dir} removed`);
    }
    for (const line of refused) console.log(`  refused: ${line}`);

    const written = [];
    for (const t of obligations) {
      // Copy one real row rather than hand-writing an INSERT per table: a hand-written column list is
      // one stale guess away from proving nothing, and every table here has a row to copy (they are
      // the tables the 2026-10-15 census saw move). Generated and identity columns are excluded, so
      // the copy stays valid on a fresh definition.
      const cols = (await client.query(
        `SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) c
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1
            AND is_generated='NEVER' AND is_identity='NO'`, [t])).rows[0].c;
      if (!cols) throw new Error(`selftest: ${t} has no insertable columns`);
      const res = await client.query(
        `INSERT INTO ${PROBE_SCHEMA}.${t} (${cols}) SELECT ${cols} FROM public.${t} LIMIT 1`);
      if (res.rowCount !== 1) {
        throw new Error(`selftest: public.${t} has no row to copy (${res.rowCount} inserted) - `
          + 'detection of a write to it cannot be proven from an empty store');
      }
      written.push(t);
    }
    await client.query(`INSERT INTO ${PROBE_SCHEMA}.${UNCOVERED_PROBE} (id) VALUES (1)`);
    console.log(`  deliberate writes: 1 row into each of ${written.length} obligation table(s) + ${UNCOVERED_PROBE}`);

    const after = Object.fromEntries((await census(client, PROBE_SCHEMA)).lines.map(parseCensusLine));
    const expectedKeys = [...written, UNCOVERED_PROBE].map((t) => `${PROBE_SCHEMA}.${t}`);
    const moved = Object.keys(after).filter((k) => before[k] !== after[k]).sort();
    const counts = Object.keys(before).length;
    const unexpected = moved.filter((k) => !expectedKeys.includes(k));
    if (unexpected.length) {
      throw new Error(`selftest FAILED: ${JSON.stringify(unexpected)} moved but nothing was written to them `
        + `(census keys: ${counts})`);
    }
    const missed = expectedKeys.filter((k) => !(k in before) || Number(after[k]) !== Number(before[k]) + 1);
    if (missed.length) {
      throw new Error(`selftest FAILED: no +1 counted for ${JSON.stringify(missed)} - the census is blind to a `
        + 'write the hard guard is supposed to refuse');
    }
    const uncoveredTagged = !isCovered(UNCOVERED_PROBE) && isCovered(`${PROBE_SCHEMA}.products`);
    if (!uncoveredTagged) {
      throw new Error(`selftest FAILED: classification disagrees - ${UNCOVERED_PROBE} should read as `
        + 'UNPROTECTED and products as protected');
    }
    const appendNote = APPEND_PROBED.map((p) => `${p.table} (append-probed by ${p.column})`).join(', ');
    console.log(`SELFTEST PASS: every one of ${written.length} obligation table(s) counted 0 -> 1 `
      + `[${written.join(', ')}], and ${UNCOVERED_PROBE} counted 0 -> 1 while classifying as UNPROTECTED; `
      + `${counts} census line(s) compared, ${counts - expectedKeys.length} unchanged; `
      + `${refused.length} unmeasurable shape(s) refused rather than reporting CLEAN`);
    console.log(`  covered set now: ${PROTECTED.length} exact-count name(s) + ${appendNote}`);
  } finally {
    if (flag('keep')) {
      console.log(`  --keep: ${PROBE_SCHEMA} left in place (drop it by name before the next selftest)`);
    } else {
      await client.query(`DROP SCHEMA ${PROBE_SCHEMA} CASCADE`);
      const gone = (await client.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name=$1`, [PROBE_SCHEMA])).rowCount;
      if (gone) throw new Error(`selftest FAILED: ${PROBE_SCHEMA} still present after DROP SCHEMA`);
      console.log(`  teardown: DROP SCHEMA ${PROBE_SCHEMA} CASCADE, confirmed absent`);
    }
  }
}

main().catch((e) => {
  console.error(`CENSUS ${mode.toUpperCase()} FAILED ${e.code || ''} ${e.message}`);
  process.exitCode = 1;
});
