'use strict';

// =========================================================================
// Every backend suite that starts a server owns it, and releasing it is part
// of the run — not a courtesy to the next suite, a guarantee about this one.
//
// The suites used to spawn `src/server.js` with `detached: true` + `unref()` and
// never kill it. Standalone that looked fine (the suite had exited, the port was
// still warm, nobody asked), and inside the chain it was worse: the next run
// refused to bind and said "port 4000 is already bound. Stop the manually-started
// backend first", because the runner will not kill a process it did not start.
// `restart_test.js` documented exactly that as the reason it exists — "a green
// 21/21 chain came to depend on a leaked process" — and commit a02971e made the
// suites reap their boundaries. This is that rule in one place.
//
// Policy, deliberately the same as the chain runner's: kill only what this
// process started. A server the operator launched by hand is never in the list,
// so it is never touched. Nothing here resolves a port to find a victim.
// =========================================================================

const { execSync } = require('child_process');

const spawnedServers = [];

// Wrap a spawn result to register it. Returns the child unchanged.
function trackServer(proc) {
  if (proc && proc.pid) spawnedServers.push(proc);
  return proc;
}

// Synchronous, so it is legal inside a process 'exit' handler.
function reapSpawnedServers() {
  const reaped = [];
  for (const proc of spawnedServers.splice(0)) {
    try {
      if (process.platform === 'win32') {
        // Detached children on Windows ignore signals; terminate the tree by pid and
        // treat an already-exited one as success.
        execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
      } else {
        proc.kill('SIGTERM');
      }
      reaped.push(proc.pid);
      console.log(`teardown: backend pid ${proc.pid} started by this run was reaped`);
    } catch (e) { /* already gone */ }
  }
  return reaped;
}

// Reap, then wait until `isUp` (a health probe against the port) stops answering, so
// whatever runs next may bind the port instead of riding a half-dead server.
async function reapAndWait(isUp, { attempts = 40, delayMs = 250 } = {}) {
  reapSpawnedServers();
  for (let i = 0; i < attempts; i++) {
    if (!(await isUp())) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

// Registered on require: a suite that aborts through a scattered `process.exit(1)` is
// still a suite that started something.
process.once('exit', reapSpawnedServers);

module.exports = { trackServer, reapSpawnedServers, reapAndWait, spawnedServers };
