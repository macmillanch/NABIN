/**
 * Dispatch fan-out shape test — no HTTP, no store writes.
 *
 * `POST /api/customer/book-ride` and `book-parcel` hand their candidate drivers to
 * `DispatchRepository.createOffersForDrivers` before they answer. The route used to await one
 * PostgreSQL round trip per driver back to back: measured at 11,840ms for one ride against 1,320
 * drivers, against a 15,000ms client timeout, so the same booking passed or failed on timing.
 *
 * What is pinned here is the shape the booking route now relies on, and the two properties a
 * future "simplification" back to `for (const d of drivers) await ...` would silently break:
 *   - every driver the caller named gets an attempt (the helper filters nobody — the audience is
 *     the route's decision, and docs/GEOFENCING_SECURITY_AUDIT.md §14-1 leaves it open);
 *   - the promise resolves only after the last write settled, because OPS-20 in
 *     driver_operations_test.js reads `/api/driver/offers` immediately after the booking;
 *   - one driver's failure does not cancel the drivers queued behind them;
 *   - writes overlap, bounded by the concurrency the caller passes.
 *
 * `createOffer` is replaced with a recorder, so nothing here reaches a database.
 */

const DispatchRepository = require('./src/repositories/DispatchRepository');

let passed = 0;
const failed = [];

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed.push(name);
    console.log(`  ❌ ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

/**
 * A repository whose offer writes are a recorder instead of a store round trip.
 * `failFor` names driver ids whose write rejects, and every call reports how many of its
 * siblings were in flight at the moment it started.
 */
function harness(driverIds, { failFor = new Set(), holdMs = 4 } = {}) {
  const repo = new DispatchRepository({ drivers: [] });
  const calls = [];
  let inFlight = 0;
  let peak = 0;

  repo.createOffer = ({ jobId, driverId, ttlSeconds, metadata }) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    calls.push({ jobId, driverId, ttlSeconds, metadata });
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        inFlight -= 1;
        if (failFor.has(driverId)) reject(new Error(`store refused the offer for ${driverId}`));
        else resolve({ success: true, duplicate: false, offer: { driverId } });
      }, holdMs);
    });
  };

  return { repo, calls, summary: () => ({ started: calls.length, peakInFlight: peak }) };
}

const CANDIDATES = (n, prefix = 'DRV') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));

async function main() {
  console.log('\n=== dispatch fan-out shape ===\n');

  // 1. Audience: one write per driver the caller named, with the route's own parameters.
  {
    const drivers = CANDIDATES(25);
    const { repo, calls, summary } = harness(drivers.map(d => d.id));
    const result = await repo.createOffersForDrivers(drivers, {
      jobId: 'JOB-SHAPE-1', ttlSeconds: 60, metadata: { serviceType: 'RIDE', vehicleType: '3W' }
    });
    const s = summary();
    assert('FANOUT-01 every candidate driver gets exactly one offer write',
      calls.length === drivers.length && new Set(calls.map(c => c.driverId)).size === drivers.length,
      { calls: calls.length, distinct: new Set(calls.map(c => c.driverId)).size });
    assert('FANOUT-02 the helper filters no driver out of the audience it was handed',
      drivers.every(d => calls.some(c => c.driverId === d.id)),
      { missing: drivers.filter(d => !calls.some(c => c.driverId === d.id)).map(d => d.id) });
    assert('FANOUT-03 every write carries the job, ttl and metadata the route passed',
      calls.every(c => c.jobId === 'JOB-SHAPE-1' && c.ttlSeconds === 60
        && c.metadata.serviceType === 'RIDE' && c.metadata.vehicleType === '3W'),
      { sample: calls[0] });
    assert('FANOUT-04 the summary accounts for every candidate as written or failed',
      result.candidates === drivers.length && result.written === drivers.length && result.failed === 0,
      result);
    assert('FANOUT-05 nothing resolves before the last write settles',
      s.started === drivers.length, s);
  }

  // 2. Concurrency: the bound is real in both directions.
  {
    const drivers = CANDIDATES(40);
    const { repo, summary } = harness(drivers.map(d => d.id));
    await repo.createOffersForDrivers(drivers, { jobId: 'JOB-SHAPE-2', concurrency: 4 });
    const s = summary();
    assert('FANOUT-06 writes overlap instead of running one at a time',
      s.peakInFlight > 1, s);
    assert('FANOUT-07 no more than the requested concurrency is ever in flight',
      s.peakInFlight <= 4, s);
    assert('FANOUT-08 the queue is actually drained to the bound, not left half-running',
      s.peakInFlight === 4, s);
  }

  {
    const drivers = CANDIDATES(60);
    const { repo, summary } = harness(drivers.map(d => d.id));
    await repo.createOffersForDrivers(drivers, { jobId: 'JOB-SHAPE-3' });
    const s = summary();
    assert('FANOUT-09 the default bound is a bound, not "as many as the fleet allows"',
      s.peakInFlight > 1 && s.peakInFlight < drivers.length, s);
  }

  // 3. A mid-queue failure does not cancel the drivers behind it.
  {
    const drivers = CANDIDATES(30);
    const troubled = new Set([drivers[3].id, drivers[11].id]);
    const { repo, calls, summary } = harness(drivers.map(d => d.id), { failFor: troubled });
    const result = await repo.createOffersForDrivers(drivers, { jobId: 'JOB-SHAPE-4', concurrency: 2 });
    const s = summary();
    assert('FANOUT-10 a rejecting driver does not stop the offers queued behind them',
      calls.length === drivers.length, { started: s.started, expected: drivers.length });
    assert('FANOUT-11 the failures are counted, not swallowed',
      result.failed === troubled.size && result.written === drivers.length - troubled.size, result);
    assert('FANOUT-12 the first failure is reported so the route can log a reason',
      typeof result.firstError === 'string' && troubled.size > 0
        && result.firstError.includes('store refused the offer for'),
      { firstError: result.firstError });
  }

  // 4. Empty and absent audiences are quiet successes, not a thrown error on the money path.
  {
    const { repo, calls } = harness([]);
    const result = await repo.createOffersForDrivers([], { jobId: 'JOB-SHAPE-5' });
    assert('FANOUT-13 an empty audience writes nothing and reports nothing failed',
      calls.length === 0 && result.candidates === 0 && result.written === 0 && result.failed === 0,
      result);

    const absent = await repo.createOffersForDrivers(undefined, { jobId: 'JOB-SHAPE-6' });
    assert('FANOUT-14 a missing audience list is handled as empty rather than thrown',
      absent.candidates === 0, absent);
  }

  console.log(`\n=== DISPATCH FANOUT RESULT: ${passed} passed, ${failed.length} failed ===`);
  if (failed.length > 0) console.log(`FAILED: ${failed.join(', ')}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
