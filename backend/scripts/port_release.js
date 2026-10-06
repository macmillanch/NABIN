/*
 * Isolated-link helpers shared by scripts/test_chain.js and its narrow regression checks.
 *
 * They live here, and not inside test_chain.js, for one reason: test_chain.js starts a chain the moment
 * it is loaded, so nothing in it can be unit-tested. Keeping a single implementation means the checks
 * exercise the exact code the runner uses instead of a transcription of it - the distinction that made
 * an earlier "verified" claim weaker than it sounded.
 *
 * Safety rule for the reaper: kill only a listener whose command line is unmistakably a NABIN
 * `src/server.js`, and only on a port the runner allocated itself. Anything else is reported as foreign
 * and left running.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LINK_ENV_FILE = path.join(__dirname, '..', '.chain-scratch', 'link.env');

/** Read the isolated environment written by `chain_scratch.js link-env`. Throws if absent/incomplete. */
function readLinkEnv(file = LINK_ENV_FILE) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  if (!out.SUPABASE_URL || !out.DATABASE_URL) throw new Error('link.env is missing SUPABASE_URL or DATABASE_URL');
  return out;
}

function releasePrivatePort(port) {
  if (!port) return 'none';
  const ps = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; `
    + 'if ($c) { $procId = $c.OwningProcess | Select-Object -First 1; '
    + '$cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").CommandLine; '
    + "if ($cl -match 'src[\\\\/]server\\.js') { "
    + 'Stop-Process -Id $procId -Force; Write-Output "released:$procId" '
    + '} else { Write-Output "skipped:foreign" } } else { Write-Output "already-free" }';
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return `${(r.stdout || '').trim()} ${(r.stderr || '').trim()}`.trim();
}

module.exports = { releasePrivatePort, readLinkEnv, LINK_ENV_FILE };
