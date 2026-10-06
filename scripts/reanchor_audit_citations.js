'use strict';

/*
 * RE-ANCHOR EVERY server.js LINE CITATION IN THE DOCS — task #139.
 *
 * The durable markdown (the Customer contract audit, the admin permission matrix, the phase
 * audits, TASKS.md) cites `server.js:N` for hundreds of route and handler facts. Every one of them
 * is a claim about a moving file: inserting sixteen lines near the top of server.js silently
 * invalidates every citation below it, which is exactly what happened twice while #132/#138/#140
 * were in flight. Hand-editing the numbers is worse than not having them — a confident wrong line
 * number sends a reader to the wrong handler.
 *
 * So this derives them instead. It parses the route registrations out of the shipped source
 * (`app.get/post/put/delete/patch`, including the array form that registers a `/api/v1/...`
 * alias beside the `/api/...` path a screen actually calls), finds which route each citation
 * belongs to from the prose around it, and rewrites the number.
 *
 * Only unambiguous cases are rewritten. A citation is skipped and reported when:
 *   - it points inside a handler rather than at its registration (a range like `4200-4202`, or
 *     a bare line with no route path in the surrounding prose);
 *   - the path it names is no longer registered at all (the route was renamed or removed —
 *     that is a finding about the doc, not a number to fix);
 *   - no route mention sits close enough before it to own the citation.
 * Those need a human/agent decision about what the sentence means, which a line number cannot
 * make. Run with no flag for the report, `--write` to apply, `--list` to dump the parse, and
 * `--check` as the suite guard that exits non-zero while any derivable citation has drifted.
 *
 * Convention this enforces: `server.js:N` means a route *registration*, derived from the source.
 * A fact that lives *inside* a handler is cited as `server.js → <greppable literal>` instead,
 * because no line number for it can survive an insert above it.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend', 'src', 'server.js');
const WRITE = process.argv.includes('--write');
const LIST = process.argv.includes('--list');
const CHECK = process.argv.includes('--check');

const srcLines = fs.readFileSync(BACKEND, 'utf8').split('\n');

// --- parse the registrations ---------------------------------------------------------
// A registration is only read as far as its first argument, so the path list is what is
// matched, never a string that happens to look like one deeper in the handler body.
const routes = []; // { method, paths: [], line }
const REG = /^app\.(get|post|put|delete|patch)\(/i;
for (let i = 0; i < srcLines.length; i++) {
  const m = srcLines[i].match(REG);
  if (!m) continue;
  const arg = srcLines[i].slice(m[0].length);
  // The first argument is either a single quoted path or an array of aliases. Cutting an array at
  // its first comma loses every alias after it, which is how `POST /api/merchant/orders/:id/status`
  // looked "dead" while its `/api/merchant/:restaurantId/...` twin was registered on the same line.
  const bracket = arg.startsWith('[') ? arg.indexOf(']') : -1;
  let argText;
  if (bracket !== -1) argText = arg.slice(0, bracket);
  else {
    const firstComma = arg.search(/,(?=(?:[^']*'[^']*')*[^']*$)/);
    argText = firstComma === -1 ? arg : arg.slice(0, firstComma);
  }
  const paths = (argText.match(/['"`]([^'"`]*)['"`]/g) || []).map((s) => s.slice(1, -1));
  if (!paths.length) continue;
  routes.push({ method: m[1].toUpperCase(), paths, line: i + 1 });
}

// `/api/x` and `/api/v1/x` are the same endpoint with two spellings; a doc may cite either.
const canonical = (p) => p.replace(/^\/api\/v1\//, '/api/');
const byPath = new Map();
for (const r of routes) {
  for (const p of r.paths) {
    const key = `${r.method} ${canonical(p)}`;
    if (!byPath.has(key)) byPath.set(key, r.line);
  }
}

if (LIST) {
  console.log(`${routes.length} registrations, ${byPath.size} canonical paths`);
  for (const [k, v] of [...byPath.entries()].sort((a, b) => a[1] - b[1])) console.log(`  ${v}  ${k}`);
  process.exit(0);
}

// --- walk one document ---------------------------------------------------------------
const PATH_IN_TEXT = /\b(GET|POST|PUT|DELETE|PATCH) (\/[A-Za-z0-9_:./*-]*[A-Za-z0-9_:/.*-])/g;
const CITATION = /server\.js:(\d+)(?:-(\d+))?/g;

// A citation belongs to a route mention only when the prose says so: the mention must be the last
// one before it, within one clause (<= MAX_GAP characters), and with no sentence break between
// them. Without those limits a second fact in the same bullet — "customerRating at server.js:3779
// is the book-ride job payload", sitting under a bullet that begins by naming /api/auth/me — would
// inherit the wrong route and get a confidently wrong number written into it.
const MAX_GAP = 60;

// Markdown wraps a sentence across lines, so the route a citation names and the citation itself are
// routinely on different physical lines of the same bullet. Blocks are the unit of meaning: a
// top-level bullet or paragraph runs until the blank line, heading, or next bullet. A table row is
// its own block — the matrix puts a route in one column and a line number in another, and two rows
// of that must never be read as one sentence.
function buildBlocks(docLines) {
  const blockOf = [];
  const blocks = [];
  const fenced = new Set();
  let fence = null;
  for (let i = 0; i < docLines.length; i++) {
    const raw = docLines[i];
    const mark = raw.match(/^\s*(```|~~~)/);
    if (mark) {
      fence = fence ? null : mark[1];
      blockOf[i] = -1;
      continue;
    }
    if (fence) {
      // Inside a fenced block a `server.js:1102` is the snippet's own provenance label, quoting code
      // as it looked then — not the document citing today's registration. Editing it would rewrite
      // quoted source and let the prose above the fence claim ownership of a number it never named.
      fenced.add(i);
      blockOf[i] = -1;
      continue;
    }
    if (/^\s*$/.test(raw)) { blockOf[i] = -1; continue; }
    // A heading is a unit of meaning in itself — `### GET /api/merchants (server.js:4421)` cites a
    // registration — but it never continues into the line below it.
    if (/^#{1,6} /.test(raw)) {
      blocks.push({ text: raw, offset: new Map([[i, 0]]) });
      blockOf[i] = blocks.length - 1;
      continue;
    }
    const opensBlock = /^[-*] /.test(raw) || raw.startsWith('|') || blocks.length === 0;
    if (opensBlock) blocks.push({ text: '', offset: new Map() });
    const b = blocks.length - 1;
    blocks[b].text = blocks[b].text ? `${blocks[b].text}\n${raw}` : raw;
    blockOf[i] = b;
    blocks[b].offset.set(i, blocks[b].text.length - raw.length);
  }
  return { blockOf, blocks, fenced };
}

function processDoc(docPath) {
  const rel = path.relative(path.join(__dirname, '..'), docPath).replace(/\\/g, '/');
  const docLines = fs.readFileSync(docPath, 'utf8').split('\n');
  const { blockOf, blocks, fenced } = buildBlocks(docLines);

  const ownerRoute = (docLineIdx, beforeCol) => {
    const b = blockOf[docLineIdx];
    if (b === -1) return null;
    const block = blocks[b];
    const upto = (block.offset.get(docLineIdx) ?? 0) + beforeCol;
    const found = [...block.text.slice(0, upto).matchAll(PATH_IN_TEXT)];
    if (!found.length) return null;
    const last = found[found.length - 1];
    const gap = block.text.slice(last.index + last[0].length, upto);
    if (gap.length > MAX_GAP || /\.\s|!\s|\?\s/.test(gap)) return null;
    return { key: `${last[1]} ${last[2]}`, block: b, clause: block.text.slice(last.index, upto).replace(/\s+/g, ' ') };
  };

  // Pass 1 — read every citation and who appears to own it.
  const hits = [];
  for (let i = 0; i < docLines.length; i++) {
    const line = docLines[i];
    if (!/server\.js:\d/.test(line)) continue;
    CITATION.lastIndex = 0;
    let m;
    while ((m = CITATION.exec(line)) !== null) {
      hits.push({ line: i, at: m.index, len: m[0].length, cited: Number(m[1]), isRange: m[2] !== undefined, text: m[0], owned: fenced.has(i) ? null : ownerRoute(i, m.index) });
    }
  }

  // A block naming one route twice is not citing one registration twice — it is saying something
  // about the *difference* between two places ("`GET /api/admin/drivers` existed at server.js:1419 and
  // again at server.js:4663", the deleted duplicate). One derived number cannot express that, and
  // writing the same line into both halves turns a finding into nonsense.
  const perBlockRoute = new Map();
  for (const h of hits) {
    if (!h.owned || h.isRange) continue;
    const key = `${h.owned.block}|${h.owned.key}`;
    perBlockRoute.set(key, (perBlockRoute.get(key) || 0) + 1);
  }

  // Pass 2 — classify, and rewrite only what is unambiguous.
  const out = [];
  const pending = new Map();
  let rewritten = 0;
  let unchanged = 0;

  for (const h of hits) {
    const line = docLines[h.line];
    // The prose is what a reviewer needs to judge an attribution, so a row that cannot be derived
    // carries its own sentence — the clause the route was read out of, or the bare line if the
    // citation has no route mention at all.
    const said = (h.owned ? `${h.owned.clause} …` : line).replace(/\s+/g, ' ').trim().slice(0, 160);
    const route = h.owned ? h.owned.key : null;
    const push = (status, shownRoute) => out.push({ doc: h.line + 1, cited: h.text, route: shownRoute, status, said });
    if (fenced.has(h.line)) {
      push('MANUAL (inside a fenced code block — the snippet quotes its own provenance)', route);
      continue;
    }
    if (h.isRange) {
      push('MANUAL (a range points inside a handler, not at a registration)', route);
      continue;
    }
    if (!route) {
      push('MANUAL (no adjacent route mention — a handler-internal line)', null);
      continue;
    }
    if (perBlockRoute.get(`${h.owned.block}|${route}`) > 1) {
      push('MANUAL (this block names that route more than once — it compares two places, not one)', route);
      continue;
    }
    const actual = byPath.get(route);
    if (actual === undefined) {
      push('DEAD CITATION (that method+path is not registered any more)', route);
      continue;
    }
    if (actual === h.cited) { unchanged++; continue; }
    rewritten++;
    push(`RE-ANCHOR -> ${actual}`, route);
    // Batched per line and applied back-to-front below, so one replacement shifting the
    // column of a later citation on the same line can never corrupt it.
    if (WRITE) {
      if (!pending.has(h.line)) pending.set(h.line, []);
      pending.get(h.line).push({ at: h.at, len: h.len, text: `server.js:${actual}` });
    }
  }

  if (WRITE && rewritten) {
    for (const [lineIdx, edits] of pending) {
      let text = docLines[lineIdx];
      for (const e of edits.sort((a, b) => b.at - a.at)) {
        text = text.slice(0, e.at) + e.text + text.slice(e.at + e.len);
      }
      docLines[lineIdx] = text;
    }
    fs.writeFileSync(docPath, docLines.join('\n'), 'utf8');
  }

  const dead = out.filter((r) => r.status.startsWith('DEAD')).length;
  const manual = out.filter((r) => r.status.startsWith('MANUAL')).length;
  console.log(`${rel}: ${unchanged} correct, ${rewritten} ${WRITE ? 'rewritten' : 'stale'}, ${manual} handler-internal, ${dead} dead`);
  // `--check` is a guard that runs inside the suite, so it stays silent about the cases it cannot
  // decide; only a drift or a dead path is worth a line of output there.
  for (const r of out) {
    if (CHECK && !/^RE-ANCHOR|^DEAD/.test(r.status)) continue;
    console.log(`    doc:${String(r.doc).padEnd(5)} ${r.cited.padEnd(16)} ${String(r.route || '(no route)').padEnd(44)} ${r.status}`);
    console.log(`          ${r.said}`);
  }
  return { rel, stale: rewritten, dead, manual };
}

// --- which documents -------------------------------------------------------------------
// Durable documents only. `.kilo/worktrees` holds other people's checkouts, `backend/scratch` is
// throwaway run output, and node_modules is not ours — rewriting citations in any of those would
// either fight another agent's work or churn files nobody reads.
const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.kilo', '.qoder', 'scratch']);

function markdownFiles(dir, collected = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) markdownFiles(full, collected);
    } else if (entry.name.endsWith('.md')) collected.push(full);
  }
  return collected;
}

const explicit = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const candidates = explicit.length
  ? explicit.map((p) => path.resolve(ROOT, p))
  : markdownFiles(ROOT).filter((p) => /server\.js:\d/.test(fs.readFileSync(p, 'utf8')));

const results = candidates.map(processDoc);
const stale = results.reduce((n, r) => n + r.stale, 0);
const dead = results.reduce((n, r) => n + r.dead, 0);

if (CHECK) {
  // A guard, not a report: the numbers below a server.js insert drift silently, and this exits
  // non-zero until someone runs `--write` (or fixes a route the doc still names after a rename).
  console.log(`\n${results.length} document(s) scanned: ${stale} stale and ${dead} dead citation(s).`);
  if (stale || dead) console.log('Fix: node scripts/reanchor_audit_citations.js --write');
  process.exitCode = stale || dead ? 1 : 0;
}
