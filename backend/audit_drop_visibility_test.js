// =========================================================================
// DROPPED AUDIT TRAILS MUST BE VISIBLE (local only)
//
// 32 of the 42 audit writes in `database.js` sit inside synchronous methods —
// `pauseService`, `setDriverStatus`, `processFinancialAdjustment` — that call
// `createAuditLog()` without awaiting, because a synchronous method cannot. When the
// store refused one of those writes the rejection had nowhere to go but the process-wide
// `unhandledRejection` net in `server.js`, which prints that *a* promise rejected and why.
// Nothing in that line says a control action lost its audit record, or which one, so the
// operator's view of "the trail is complete" and the truth were indistinguishable.
//
// Two rules this file pins:
//   1. A drop is announced as a drop, with the action and the target it belongs to, at the
//      moment it happens — and it does not reach the process net.
//   2. Making it legible must not cost a caller that *does* await its error: reporting and
//      propagating are separate jobs, and swallowing is neither.
//
// The store itself is replaced with one that refuses, in this process only. No server is
// spawned and nothing is written to a table, so no fixture or audit row is left behind.
// =========================================================================

const db = require('./src/database');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

const logged = [];
const realConsoleError = console.error;
console.error = (...args) => logged.push(args.map(String).join(' '));

function restoreConsole() {
  console.error = realConsoleError;
}

const realRepo = db.auditLogRepo;

function refusingRepo() {
  db.auditLogRepo = {
    create: () => Promise.reject(new Error('simulated store refusal'))
  };
}

// Lets every already-queued microtask and the next timers run, so a rejection that was
// going to escape would have escaped by then.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const ENTRY = {
  adminId: 'adm_test_harness',
  adminName: 'Audit Drop Harness',
  role: 'SUPER_ADMIN',
  module: 'SERVICE',
  action: 'SERVICE_PAUSE',
  targetEntityType: 'PLATFORM_SERVICE',
  targetEntityId: 'grocery',
  reason: 'Harness probe: this trail is deliberately refused and must never be written.'
};

async function main() {
  const before = db.auditLogs.length;
  refusingRepo();

  // 1. The fire-and-forget shape, exactly as `pauseService` uses it: no await, no catch.
  db.createAuditLog(ENTRY);
  await settle();

  const dropLine = logged.find((line) => line.includes('DROPPED TRAIL'));
  check('AD-01', Boolean(dropLine), `a refused fire-and-forget write is announced as a dropped trail (saw: ${JSON.stringify(logged.join(' | ')).slice(0, 160)})`);
  check('AD-02', /SERVICE_PAUSE/.test(dropLine || '') && /grocery/.test(dropLine || ''),
    `the line names the action and the target it belongs to: ${dropLine || '(none)'}`);
  check('AD-03', !unhandled.length, `nothing reached the process-wide unhandledRejection net (events: ${unhandled.length})`);
  check('AD-04', /SERVICE\/SERVICE_PAUSE/.test(dropLine || '') && /PLATFORM_SERVICE\/grocery/.test(dropLine || ''),
    `the line carries module, action, target type and id in one readable shape: ${dropLine || '(none)'}`);

  // 2. A caller that awaits must still receive the failure — reporting cannot become
  //    swallowing, or an admin route that fails closed on its audit would silently
  //    believe the write succeeded.
  logged.length = 0;
  let awaitedError = null;
  try {
    await db.createAuditLog({ ...ENTRY, action: 'SERVICE_RESUME' });
  } catch (err) {
    awaitedError = err;
  }
  check('AD-05', Boolean(awaitedError), `the awaiting caller still sees the rejection: ${awaitedError && awaitedError.message}`);
  check('AD-06', logged.some((line) => line.includes('DROPPED TRAIL') && /SERVICE_RESUME/.test(line)),
    'and the drop is reported even when the caller handles it — both facts are useful');

  // 3. A refused write leaves no trace behind: the in-memory collection the offline mode
  //    uses must not gain the entry the store said no to, or a read of the trail would show
  //    an event that never happened.
  check('AD-07', db.auditLogs.length === before, `a refused write adds nothing to the trail (${before} → ${db.auditLogs.length})`);

  // 4. The success path is unaffected by the handler — a resolved promise with a rejection
  //    handler attached still resolves, and an awaiting caller gets the row back.
  logged.length = 0;
  let written = null;
  db.auditLogRepo = { create: async (entry) => ({ id: 'AUD-HARNESS-1', action: entry.action }) };
  try {
    written = await db.createAuditLog({ ...ENTRY, action: 'AUDIT_STORE_ACCEPTED' });
  } catch (err) {
    awaitedError = err;
  }
  check('AD-08', Boolean(written && written.id === 'AUD-HARNESS-1') && !logged.some((l) => l.includes('DROPPED')),
    `an accepted write resolves normally with no drop report (wrote ${written && written.id})`);

  db.auditLogRepo = realRepo;
  restoreConsole();

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n========================================================================');
  console.log(`📊 AUDIT DROP VISIBILITY: ${results.length - failed} PASSED, ${failed} FAILED (Total: ${results.length})`);
  console.log('========================================================================\n');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  restoreConsole();
  db.auditLogRepo = realRepo;
  console.error('❌ [AD-99] harness threw:', err);
  process.exitCode = 1;
});
