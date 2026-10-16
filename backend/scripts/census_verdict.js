'use strict';
/**
 * F-10's decision point, extracted because `test_chain.js` cannot be imported without running a chain -
 * the same reason `scripts/port_release.js` exists. What lives here is the only thing that decides
 * whether a census counted the store or failed to count it, and that line has to be testable without a
 * 20-minute chain run.
 *
 * Three outcomes, and they are NOT equivalent:
 *   clean / drift  - the census MEASURED the schema. Drift is report-only, because a non-isolated link
 *                    is allowed to write public state; the run's per-link guards already judge the link.
 *   unavailable    - the census never measured anything: the CLI exited non-zero, or exited 0 while
 *                    printing neither `CENSUS CLEAN` nor a `DRIFT` line. This is a missing piece of
 *                    isolation evidence, so the runner must fail the run on it.
 *
 * The bug this closes: a failed baseline used to be recorded in `census.error` and consulted nowhere,
 * and a compare that crashed was recorded nowhere at all, so `77/77 links clean` + exit 0 could be
 * reported for a run whose independent whole-public guard never read the store.
 *
 * `summarize` is injected (the runner passes its own `isolationFailureSummary`) so a stack-trace-
 * strewn child output is reduced the same way everywhere instead of re-implemented per call site.
 */

const STATUS_NULL = 'null (the census child process never ran';

function statusText(status, proc) {
  if (status !== null && status !== undefined) return String(status);
  const why = proc && proc.error && proc.error.message ? proc.error.message : 'spawn failed';
  return `${STATUS_NULL} — ${why})`;
}

function tail(text) {
  return `${text || ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
}

/** The before-link-1 snapshot. Its exit status is the whole question: a baseline that was never
 *  written cannot be compared against, and the runner must not set `ref` from a failed snapshot. */
function baselineOutcome(snap, summarize) {
  if (snap && snap.status === 0) return { ok: true, state: 'baselined', drift: [] };
  const reason = `snapshot failed (exit ${statusText(snap && snap.status, snap)}): `
    + (summarize || ((t) => t))(`${snap && snap.stdout ? snap.stdout : ''}\n${snap && snap.stderr ? snap.stderr : ''}`);
  return { ok: false, state: 'unavailable', drift: [], reason };
}

/** The post-run compare. Drift lines are a measurement; an absent verdict is not. */
function compareOutcome(cmp, summarize) {
  const stdout = (cmp && cmp.stdout) || '';
  const stderr = (cmp && cmp.stderr) || '';
  const lines = stdout.split(/\r?\n/).filter((l) => /^DRIFT |^CENSUS CLEAN/.test(l));
  const drift = lines.filter((l) => l.startsWith('DRIFT'));
  const cleanSeen = /^CENSUS CLEAN/.test(lines.join('\n'));
  // The compare is run with `--report-only`, which is what makes drift exit 0, so a non-zero status
  // here is the census itself failing - never "the store moved".
  if ((cmp && cmp.status !== 0) || (!cleanSeen && !drift.length)) {
    const cause = tail(stderr) || (summarize || ((t) => t))(`${stdout}\n${stderr}`);
    return {
      ok: false,
      state: 'unavailable',
      drift,
      // `false`, not absent: the run evidence keeps one shape whether the census measured or not, and
      // `state` is what separates "measured, nothing moved" from "never measured".
      clean: false,
      reason: `compare exited ${statusText(cmp && cmp.status, cmp)} and produced no verdict line: ${cause}`,
    };
  }
  return { ok: true, state: drift.length ? 'drift' : 'clean', drift, clean: cleanSeen };
}

module.exports = { baselineOutcome, compareOutcome };
