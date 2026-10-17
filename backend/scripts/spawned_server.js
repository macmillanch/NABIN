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

const { execSync, spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

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

// A second NABIN instance, on a port of its own, whose periodic session tick reads the store
// and never writes it.
//
// Cross-instance adoption — a `backend_sessions` row that some other process wrote becoming
// honourable here — is performed by `src/server.js`'s reconcile timer. The chain runner boots
// both servers it owns with that timer OFF (F-13, measured 2026-10-16: its first statement is
// a DELETE of expired rows from whatever store `liveStore()` serves, and for the shared harness
// that store is `public`), so a suite may no longer wait on a background timer it does not own
// for the behaviour it asserts. It starts the instance that performs it instead.
//
// Two switches, both read at boot: `NABIN_SESSION_RECONCILE_MS` gives the tick a short explicit
// interval, so the check measures seconds instead of polling a 15 s window, and
// `NABIN_SESSION_PRUNE=off` keeps the store DELETE out of it — the suite is measuring adoption,
// and nothing here deletes from a store the suite did not provision.
async function spawnConvergingInstance({ port, tickMs = 1500, attempts = 60, delayMs = 250 } = {}) {
  const chosen = port || await findFreePort();
  const backendDir = path.join(__dirname, '..');
  const proc = trackServer(spawn(process.execPath, [path.join(backendDir, 'src/server.js')], {
    cwd: backendDir,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(chosen),
      NABIN_SESSION_RECONCILE_MS: String(tickMs),
      NABIN_SESSION_PRUNE: 'off'
    }
  }));
  proc.unref();
  const baseUrl = `http://127.0.0.1:${chosen}`;
  const readyWindowMs = attempts * delayMs;
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    if (await httpStatus(`${baseUrl}/api/health`) === 200) {
      return { proc, port: chosen, baseUrl, tickMs, readyWindowMs, ready: true };
    }
  }
  // Not a failure of the assertion — a failure of the boundary the assertion runs on. The
  // caller reports it as its own failed check rather than letting a missing server look like
  // a missing adoption.
  return { proc, port: chosen, baseUrl, tickMs, readyWindowMs, ready: false };
}

// Ephemeral-port handshake: bind 0, read the port the OS gave, release it. The child binds it
// a moment later; nothing here kills a process to free a port.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.once('listening', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.listen(0, '127.0.0.1');
  });
}

function httpStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
}

// Registered on require: a suite that aborts through a scattered `process.exit(1)` is
// still a suite that started something.
process.once('exit', reapSpawnedServers);

module.exports = { trackServer, reapSpawnedServers, reapAndWait, spawnedServers, spawnConvergingInstance, findFreePort };
