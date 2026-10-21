/*
 * NABIN — #481 §3: scoped repair of the driver positions the old fallback invented.
 *
 * `DriverRepository.create()` used to write the Delhi sentinel (28.6139, 77.2090) into
 * `drivers.current_lat`/`current_lng` for a driver that never reported a position, so a chain-run
 * fixture driver can carry a durable coordinate no GPS ever produced. The code fix is in place and
 * measured; the rows it left behind are what this tool is for. `drivers.current_lat`/`current_lng`
 * are nullable with NO DEFAULT (supabase/migrations/001_central_schema.sql:62), so "unknown" is a
 * representable state and the repair writes that state — never a replacement coordinate.
 *
 * Why this is a tool and not an ad-hoc UPDATE: the brief forbids a blanket update, and the honest
 * scope of a blanket update is unknowable from the coordinate alone. A row sitting on the sentinel
 * could be a fallback artifact or a driver who genuinely reported that spot. So the write set is
 * the rows whose ORIGIN is provable — the sentinel AND the fallback signature the old code wrote
 * with it — and every other sentinel row is refused as a report, not repaired. The signature rows
 * additionally have to be unconnected: a driver with a job, a payout, an account or an online flag
 * is a driver a coordinate could have meant something to, and the tool stops rather than guess.
 *
 * Dry-run by default. `--apply` is required for a write, and the write happens in one transaction
 * that rolls back unless the affected-row count equals the count this process just reviewed — so
 * the reviewed set and the written set cannot differ, and a row that changed underneath is refused.
 * Nothing outside `drivers.current_lat`/`current_lng` is touched: `last_heartbeat` is a real
 * observation, and `dispatch_offers`, `jobs`, `driver_payouts` and `audit_logs` are history.
 *
 * Usage (from backend/, against the local Docker target):
 *   node scripts/with_local_target.js node scripts/repair_fabricated_driver_positions.js
 *   node scripts/with_local_target.js node scripts/repair_fabricated_driver_positions.js --apply
 *   --backup-out=<path>   where the prior values are written (default .chain-logs/repairs/<stamp>.json)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { requireLoopbackPgTarget } = require('./chain_target_guard');

const SENTINEL = 'current_lat = 28.6139 AND current_lng = 77.2090';
// A row that reports some position that is not the sentinel. The COALESCE keeps a half-NULL pair
// (one coordinate reported, one missing) inside the honest set instead of losing it to NULL logic.
const OTHER_POSITION = "(current_lat IS NOT NULL OR current_lng IS NOT NULL) "
  + "AND COALESCE(current_lat = 28.6139 AND current_lng = 77.2090, FALSE) = FALSE";
// The two columns the removed fallback always wrote together (`DriverRepository.create()` also set
// `area: 'Delhi Operations Zone'`, which was projection-only — there is no `drivers.area` column).
const SIGNATURE = "name = 'Unlinked M4 Driver' AND vehicle_number = 'DL01UNLINKED'";

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const backupArg = argv.find((a) => a.startsWith('--backup-out='));

async function main() {
  const target = requireLoopbackPgTarget({ label: '481 position repair' });
  console.log(`target: ${target.host}:${target.port}/${target.database} (from ${target.source})`);
  console.log(`mode:   ${apply ? 'APPLY (writes current_lat/current_lng to NULL)' : 'DRY-RUN (read-only)'}`);

  const pg = new Client({ connectionString: target.connectionString });
  await pg.connect();
  try {
    const count = async (sql, params = []) => Number((await pg.query(sql, params)).rows[0].n);

    // --- provenance: the write set, and everything the write set cannot be ---
    const sentinelAll = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${SENTINEL}`);
    const candidates = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${SENTINEL} AND ${SIGNATURE}`);
    const ambiguous = sentinelAll - candidates;
    const halfNull = await count(
      'SELECT count(*)::int AS n FROM drivers WHERE (current_lat IS NULL) <> (current_lng IS NULL)');
    const honestPositions = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${OTHER_POSITION}`);

    // A repair that could not name the origin of every row it touched would be a blanket update.
    if (ambiguous > 0) {
      refuse(`${ambiguous} sentinel row(s) are NOT on the fallback signature — their origin is not `
        + `provable, so nothing was written. Review them separately (candidates: ${candidates}).`);
    }
    if (candidates === 0) {
      console.log('nothing to repair: no row is both on the sentinel and on the fallback signature.');
      return;
    }

    // --- linkage: a row a coordinate could still mean something to is out of scope ---
    const linked = {
      jobs: await count(`SELECT count(*)::int AS n FROM drivers d WHERE ${SENTINEL} AND ${SIGNATURE}
        AND EXISTS (SELECT 1 FROM jobs j WHERE j.driver_id = d.id)`),
      driver_payouts: await count(`SELECT count(*)::int AS n FROM drivers d WHERE ${SENTINEL} AND ${SIGNATURE}
        AND EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id = d.id)`),
      user_id: await count(`SELECT count(*)::int AS n FROM drivers WHERE ${SENTINEL} AND ${SIGNATURE}
        AND user_id IS NOT NULL`),
      is_online: await count(`SELECT count(*)::int AS n FROM drivers WHERE ${SENTINEL} AND ${SIGNATURE}
        AND is_online`),
    };
    const linkedTotal = Object.values(linked).reduce((a, b) => a + b, 0);
    if (linkedTotal > 0) {
      refuse(`candidate row(s) are connected to real operations (${Object.entries(linked)
        .map(([k, v]) => `${k}=${v}`).join(', ')}) — a fabricated coordinate on an engaged driver is `
        + 'a question for the owner, not a NULL. Nothing was written.');
    }

    // Broadcast history is expected on fixture drivers and is explicitly NOT rewritten: an offer
    // records what the dispatcher believed at the time, and overwriting it would destroy evidence.
    const withOffers = await count(`SELECT count(*)::int AS n FROM drivers d WHERE ${SENTINEL} AND ${SIGNATURE}
      AND EXISTS (SELECT 1 FROM dispatch_offers o WHERE o.driver_id = d.id::text)`);

    console.log([
      `sentinel rows (any)        : ${sentinelAll}`,
      `  on the fallback signature: ${candidates}   <- the only rows this tool may write`,
      `  off the signature        : ${ambiguous}   <- requires separate review`,
      `half-NULL coordinate pairs : ${halfNull}`,
      `other (honest) positions   : ${honestPositions}   <- never touched`,
      `candidates with dispatch_offers rows: ${withOffers}   <- left as history`,
    ].join('\n'));

    const before = (await pg.query(
      `SELECT id, name, vehicle_number, phone, current_lat, current_lng, last_heartbeat
         FROM drivers WHERE ${SENTINEL} AND ${SIGNATURE} ORDER BY id`)).rows;
    if (before.length !== candidates) {
      refuse(`reviewed ${candidates} candidate(s) but read back ${before.length} row(s). Nothing written.`);
    }

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    const backupPath = path.resolve(backupArg ? backupArg.split('=')[1]
      : path.join(__dirname, '..', '.chain-logs', 'repairs', `${stamp}_481_driver_positions.json`));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    // Backup first: an --apply that cannot record the values it is about to erase is refused before
    // the database sees a statement, so there is never a write whose prior state nobody kept.
    fs.writeFileSync(backupPath, JSON.stringify({
      target: `${target.host}:${target.port}/${target.database}`,
      writtenAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry-run',
      reason: '#481 fabricated driver position (Delhi sentinel written by the removed create() fallback)',
      scope: { sentinel: '28.6139, 77.2090', signature: SIGNATURE, columns: ['current_lat', 'current_lng'] },
      rows: before,
    }, null, 2), 'utf8');
    console.log(`prior values (id, lat, lng, last_heartbeat) backed up to: ${backupPath}`);

    if (!apply) {
      console.log('\nDRY-RUN COMPLETE: no write statement was issued. Re-run with --apply to NULL the '
        + `${candidates} provenance-verified row(s).`);
      return;
    }

    await pg.query('BEGIN');
    try {
      await pg.query("SET LOCAL lock_timeout = '5s'");
      const nowCount = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${SENTINEL} AND ${SIGNATURE}`);
      if (nowCount !== candidates) {
        throw new Error(`candidate count drifted between review (${candidates}) and write (${nowCount})`);
      }
      const sentinelBefore = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${SENTINEL}`);
      const otherBefore = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${OTHER_POSITION}`);
      const updated = await pg.query(
        `UPDATE drivers SET current_lat = NULL, current_lng = NULL
          WHERE ${SENTINEL} AND ${SIGNATURE}
            AND id = ANY($1::uuid[])
          RETURNING id`, [before.map((r) => r.id)]);
      if (updated.rowCount !== candidates) {
        throw new Error(`updated ${updated.rowCount} row(s), reviewed ${candidates}`);
      }
      // Two whole-store checks around the write, not a trust in the WHERE clause: the sentinel set
      // must shrink by exactly the reviewed count, and the set of rows holding some other position
      // must not move at all. Either one drifting means this transaction did not do the one thing
      // it was shown to do, so it rolls back instead of committing a surprise.
      const sentinelAfter = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${SENTINEL}`);
      const otherAfter = await count(`SELECT count(*)::int AS n FROM drivers WHERE ${OTHER_POSITION}`);
      if (sentinelAfter !== sentinelBefore - candidates) {
        throw new Error(`sentinel rows went ${sentinelBefore} -> ${sentinelAfter}, expected exactly `
          + `-${candidates}`);
      }
      if (otherAfter !== otherBefore) {
        throw new Error(`rows holding another position moved from ${otherBefore} to ${otherAfter}; `
          + 'the repair must touch none of them');
      }
      await pg.query('COMMIT');
      console.log(`\nAPPLIED: ${updated.rowCount} row(s) now hold the schema's own unknown (NULL).`);
      console.log(`sentinel rows ${sentinelBefore} -> ${sentinelAfter}; other positions ${otherBefore} `
        + `-> ${otherAfter} (unchanged); last_heartbeat, dispatch_offers, jobs, driver_payouts and `
        + 'audit_logs were not written by this statement.');
    } catch (err) {
      await pg.query('ROLLBACK').catch(() => {});
      refuse(`transaction rolled back, zero rows written: ${err.message}`);
    }
  } finally {
    await pg.end().catch(() => {});
  }
}

function refuse(reason) {
  console.error(`REPAIR REFUSED: ${reason}`);
  process.exit(2);
}

main().catch((err) => {
  console.error('REPAIR FAILED:', err.message);
  process.exit(1);
});
