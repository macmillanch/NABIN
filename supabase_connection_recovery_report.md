# NABIN — Supabase Connection Recovery Report

**Date**: 2026-09-20
**Mode**: PLAN-ONLY / connection diagnosis only. No code modified, no migration,
no schema change, no commit, no push.

---

## 1. Security

- Prior `anon` + `service_role` keys were exposed in chat/shell history → treated
  as **compromised**.
- User was instructed to **rotate both keys** in the Supabase Dashboard and place
  the NEW values directly into `backend/.env` (never via chat).
- This report contains **no secrets**: no key values, no `.env` contents, no
  echoed environment variables.
- `backend/.env` is gitignored (root `.gitignore:7` `.env`; confirmed via
  `git check-ignore -v backend/.env`). `git diff -- backend/.env` shows no
  tracked change. Credentials remain local-only.
- Shell history cleanup recommended: `Clear-History` + delete
  `(Get-PSReadlineOption).HistorySavePath` content.
- NOTE: a temporary masked diagnostic script was written to the OS temp dir
  (outside the repo) and deleted after use. It printed only
  configured/set/missing/placeholder + DNS/TCP/HTTPS reachability — never
  secrets. Deletion command output was not captured by shell integration; file
  should be re-verified absent before next session.

## 2. Configuration (masked)

- `SUPABASE_URL`: **configured** (non-placeholder, valid Supabase HTTPS host)
- `SUPABASE_ANON_KEY`: **set** (non-placeholder)
- `SUPABASE_SERVICE_ROLE_KEY`: **set** (non-placeholder)
- `SUPABASE_POSTGRES_LIVE`: `true`; `NODE_ENV`: `development`
- Masked probe result: configuration present — this does **NOT** prove reachability.

## 3. Network diagnosis (no credentials involved)

| Layer   | Result    | Detail                                  |
|---------|-----------|-----------------------------------------|
| DNS     | FAILURE   | hostname lookup → `ENOTFOUND`           |
| TCP 443 | FAILURE   | inherits DNS failure → `ENOTFOUND`      |
| HTTPS   | FAILURE   | inherits DNS failure → `ENOTFOUND`      |

**Classification: DNS FAILURE** — the configured Supabase hostname does not
resolve from this machine. Per the task's Step 4/7 taxonomy this is
**Case A (environment/network/project reachability)**, NOT an authentication
failure. No key problem may be claimed until HTTP connectivity exists.

Likely causes (in order):
1. Supabase project paused, deleted, or never activated (old values carried
   `iat` Dec-2026 timestamps; needs Dashboard confirmation).
2. Hostname typo / values from a different (deleted) project, post-rotation.
3. Local DNS egress filtering (test: resolve any public host, e.g. `google.com`).

## 4. Supabase live check

- Ran existing `backend/scripts/verify_supabase.js` (unaltered).
- Result: `configured: true, connected: false, error: 'TypeError: fetch failed',
  mode: 'POSTGRES_DISCONNECTED'`.
- Consistent with DNS FAILURE — SDK cannot reach the host at all.
- NOTE: `src/supabase.js:38` prints the full `SUPABASE_URL` on init and the
  verify script's dotenv loader echoed an unrelated full URL line into the
  terminal during this run. Recommend redacting that log line (prints
  project hostname) in a future approved change — not done here (PLAN-ONLY).

## 5. Project state

- **Unverified** — user must confirm in the Supabase Dashboard that the project
  is active / not paused / not deleted / reachable. No remote DB change was made
  (no migrations, no schema/data modifications).

## 6. Final status

**BLOCKED — DNS FAILURE (Case A).**

- Do NOT rotate credentials again yet — rotation cannot fix unresolvable DNS.
- Next actions:
  1. User confirms project state in Supabase Dashboard (active, unpaused).
  2. User confirms the project Reference ID matches the configured hostname
     (Dashboard → Project Settings shows the canonical URL).
  3. If Dashboard shows a different hostname, user updates `backend/.env`
     directly; then re-run masked DNS → TCP → HTTPS → `verify_supabase.js`.
  4. If Dashboard hostname matches but still `ENOTFOUND` locally, investigate
     local DNS (flush resolver cache, try alternate DNS) — environment issue.
  5. Only after `CONNECTED` may Customer App implementation work resume; no
     remote schema changes without explicit authorization.
