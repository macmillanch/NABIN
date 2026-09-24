# NABIN — OWNER CLARIFICATION EXPLANATION

**What this document is.** A plain-language explanation of the five open questions in
`docs/OWNER_SECURITY_CLARIFICATIONS.md`, written so the owner can decide without needing to be a database
or security engineer. **It does not choose for you, does not rank the options, and does not tell you which
option is safest.** It states what each option would change, who would notice, and what it would cost to
build and keep running. Nothing in this file is implemented, and nothing in it authorizes anything.

**How to read it.** Every option gets the same thirteen lines, so options can be compared against each
other on the same axes. Lines that genuinely do not apply say "no change" rather than being left out. If a
line is marked **(verify at execution)**, it means the number or behaviour behind that claim has not been
measured in this repository and the implementing pass must measure it before relying on it.

**The thirteen lines, in order.** Meaning in simple language · What changes in NABIN · Customer app ·
Driver app · Merchant / admin · Security consequence · Data / database consequence · Development complexity
· Maintenance complexity · Potential downside · If the decision is postponed · Whether it blocks other
phases.

---

## Words used here, in one line each

| Term | Plain meaning in NABIN |
| --- | --- |
| **Geo-fence** | A drawn boundary on the map (a polygon or a circle) that can add a surcharge to a fare inside it. Stored in the `geo_fences` table. |
| **Surge rule** | A separate pricing instruction ("multiply by 1.5 between 6pm and 10pm") that may be attached to a fence. Stored in `surge_zones`. |
| **Cascade delete** | A database rule that says "when you delete this row, also delete the rows hanging off it". Automatic, silent, and irreversible. |
| **Authoritative record** | The row that is actually stored in PostgreSQL — the version that survives a restart. Everything else is a copy. |
| **Mirror (audit)** | A copy of recent audit records held inside the running server's memory, used when the database cannot be reached. |
| **TTL (time-to-live)** | How old cached data is allowed to get before the server goes and re-reads it. A 30-second TTL means "at most 30 seconds behind". |
| **Index** | A separate lookup structure that lets the database find "the admin with this phone number" without reading every row. |
| **Unique constraint** | A database rule that refuses to save a row if the value already exists elsewhere. |
| **Oracle** | Here: a door that answers a secret question if you ask it in the right order. A "pricing oracle" lets an outsider learn our internal rates by submitting coordinates and reading the reply. |
| **Throttle / rate limit** | A cap on how many times one caller may hit an endpoint in a period. |
| **Migration** | A versioned SQL file that changes the database's shape. Applied by `backend/scripts/migrate.js`. |
| **DML** | A change to rows rather than to shape (an `INSERT`/`UPDATE`/`DELETE`). Not versioned, so it has no tidy undo. |

---

# Question 1 — Historical geo cleanup

**The numbers, once, so they do not have to be repeated.** `geo_fences` holds **447** boundaries: **3**
legitimate ones (Connaught Place, Cyber City DLF, IGI Airport Terminal 3) and **444** identified
historical/test rows. `surge_zones` holds **445** rules. Deleting the 444 fences takes **256** rules with
them by cascade, leaving **189** rules standing — and **179** of those 189 are duplicate ACTIVE rows
sitting on the *kept* IGI Airport fence. **The legitimacy of those 179 has not been established. They are
not assumed to be test data, and they are not assumed to be production data.** All 444 residue fences are
currently `is_active` with a multiplier above 1 and a surcharge above zero, and they share only 3 distinct
shapes between them — which is why they are a live pricing surface and not harmless clutter.

### Option 1A — Delete the 444 fences, accept the 256 cascade deletions, leave the 189 rules alone

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Throw away the fake boundaries. Whatever the database automatically removes along with them, remove. Don't touch anything that survives." |
| Changes in NABIN | The map shows 3 boundaries instead of 447. The pricing engine stops matching coordinates against 444 fake zones. Admin lists get short enough to read. |
| Customer app | A customer asking "what does this trip cost" stops being able to be charged a surcharge from a boundary that never existed. Anything inside the three real zones is unaffected. |
| Driver app | No change. Drivers do not read fences; the fare is already fixed on the job row. |
| Merchant / admin | The admin map and the geo lists drop from 447 rows to 3. Anyone who was counting fences to check the system is healthy will see a different number and must be told the new one. |
| Security consequence | The public-readable list of boundaries shrinks to the real ones. Note that the *reading* of those rows by strangers is closed by a different decision (the anonymous-read lock), not by this one. |
| Data / database consequence | 444 fence rows and 256 rule rows are gone. This is DML: no migration file, and **no schema-level undo**. The only rollback is a database dump taken beforehand and restored afterwards. |
| Development complexity | Low. The work is not the `DELETE`; it is producing the exact list of 444 ids at execution time, because no reliable pattern separates them from real data. |
| Maintenance complexity | Low after the fact — but the residue can grow again, because test runs are what created it. A re-run of this cleanup at some future date is likely. |
| Potential downside | The 179 duplicate ACTIVE rules on the airport zone stay, so the surge table keeps looking wrong (179 rows of what reads as one rule). Deleting the fences also means the *evidence* of how the residue was produced disappears with them. |
| If postponed | Nothing gets worse on its own. The 444 stay active pricing inputs and stay readable through the door that Phase 1 closes independently. |
| Blocks other phases | Does not block, but it changes the expected counts that three test files assert (447/445 → 3/189), so those assertions must be re-measured in the same window. |

### Option 1B — Delete the 444 fences **and** investigate / remediate the remaining 189 rules

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Clean both tables, not just the one named in the decision — including the airport rules whose status nobody has confirmed." |
| Changes in NABIN | Same as 1A, plus a deliberate decision about 179 airport rules and 10 rules with no fence attached. In practice the airport zone ends up with one active surge rule instead of 179 identical ones. |
| Customer app | A trip touching the airport is quoted against one rule rather than a pile of identical rules. The visible multiplier would be the same (all 179 carry 1.50), so the fare does not change **provided** nothing about having many copies affects the outcome — which is a measurement, not an assumption. |
| Driver app | No change. |
| Merchant / admin | The admin surge list becomes readable, and the "which rule fired" question becomes answerable. The operator has to state what the airport zone's surge should actually be. |
| Security consequence | Same as 1A. Marginally easier fraud detection, because one airport rule produces one audit trail instead of 179 candidates. |
| Data / database consequence | 444 fences + 256 cascaded rules + up to 178 more rule rows removed. Bigger irreversible DML step, and now the deletion target includes rows on a **kept** fence, which is where a mistake becomes a real pricing change. |
| Development complexity | Medium. Requires reading the engine's rule-selection code to confirm whether 179 identical active rules behave as one, then a reviewed keep-one decision per group, then the delete. |
| Maintenance complexity | Low afterwards: after this option the two geo tables contain no rows whose status is unexplained. |
| Potential downside | This is the option that can go wrong in the direction that matters: the 179 rows are attached to a boundary you decided to keep, and their legitimacy has not been established. If they turn out to be intentional, deleting them removes live airport surge. An explicit statement about them is unavoidable here. |
| If postponed | You can take 1A now and treat 1B as a follow-up. The 179 rows do not spread. |
| Blocks other phases | No. It extends Phase 4's scope and adds a decision the current paperwork does not yet name. |

### Option 1C — Keep the fences for now, run a separate cleanup investigation

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Change nothing yet. Send someone to find out exactly where these 444 rows came from and what depends on them, and come back with a plan." |
| Changes in NABIN | Nothing changes for a period. The investigation produces a document, not a cleaner system. |
| Customer app | No change: today's behaviour (including quotes that can use a fake boundary's surcharge) continues. |
| Driver app | No change. |
| Merchant / admin | The map keeps 447 boundaries and keeps needing filters to find anything. |
| Security consequence | The geometry list stays as it is until Phase 1's lock is applied. The audit trail keeps records naming fixtures that no real map has. |
| Data / database consequence | None. That is the point of this option. Fully reversible by definition, because nothing happened. |
| Development complexity | Zero for the system; the cost is investigation time and a second decision later. |
| Maintenance complexity | The known failure mode of "we'll look into it": the next measurement pass re-derives the same 444 rows at the same cost, and test runs keep adding more. |
| Potential downside | The 444 active fake boundaries stay live pricing inputs. If any is ever quoted against, no one is told it is fictional. |
| If postponed | This *is* the postpone option, so the honest line is what a postponement costs: continued noise in every geo count, and continued need to distinguish real from fake in every geo report. |
| Blocks other phases | Nothing, and it is the only option that does not force the count-dependent assertions to be re-baselined in this round. |

**Where the three differ, stated without ranking.** All three accept that 444 rows are identified and 3 are
kept. 1A and 1B both delete now; 1C deletes later or never. 1B is the only one that touches a row attached
to a fence you are keeping. 1A is the only one whose deletion target is fully described by the decision
already on file. 1C is the only one with no irreversible step.

---

# Question 2 — Admin phone duplicates

**Before the options — the four things you asked to have explained.**

- **What admins experience today.** A phone that is enrolled on exactly one account works. The number
  shared by 50 active accounts cannot: the lookup finds more than one match and refuses, by design, with
  "This phone number is enrolled for more than one administrator account. Access is refused until that is
  corrected." The refusal is correct behaviour — it is the safety device doing its job — but it surfaces to
  the caller as **HTTP 400** rather than the "conflict / forbidden" status the comparable username check
  uses, which reads like "bad input" instead of "identity ambiguous". Separately, every phone-login attempt
  reads **all 430 admin rows into server memory** and filters them in JavaScript, and that read includes
  each admin's password hash and salt (they are fetched, not sent anywhere).
- **What changes after normalization + indexing.** Normalizing means storing a second, tidy copy of each
  number (`+91 98112 33445` → `+919811233445`) so "same number typed two ways" becomes findable. Indexing
  means the database can jump straight to that row instead of scanning. Practical effect: the login lookup
  asks the database for one thing, reads a couple of rows, stops carrying password material, and behaves
  the same whether the table holds 430 admins or 4,300.
- **Why uniqueness cannot simply be added immediately.** A UNIQUE rule is enforced *when data is written*.
  Adding it asks the database to check the 50 rows already there; they collide, so the database refuses the
  change and the migration fails. A constraint can't be retro-actively true while its data is false.
- **What resolving the duplicates actually takes.** Someone with authority over staff accounts picks an
  outcome per account: give it its own number, mark it inactive, or confirm it should not exist. That is
  ~50 human decisions, each one about a person's access. It is then done through the admin screens so it is
  audited, and the duplicate report is re-run until it is clean. **No automatic merge. No automatic
  rename. No automatic deletion. No automatic reassignment** — under either option below.

### Option 2A — The owner supplies/approves an account-by-account remediation list before the uniqueness migration

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "I will go through the 50 accounts one at a time and say what each should become, and only after that do we add the rule." |
| Changes in NABIN | The phone column becomes normalized and indexed (that part is independent and can ship now), and later the uniqueness rule lands and stays landed. |
| Customer app | No change. Customers do not authenticate as admins. |
| Driver app | No change. |
| Merchant / admin | Admins holding that shared number may lose a login path they have never actually used (it refuses today), or gain a working one once their account has its own number. Whoever owns the 50 rows is asked for a decision on each. |
| Security consequence | Strengthens over time: one number can only ever point at one admin, and the whole-table credential read disappears at the normalization step rather than waiting for the constraint. |
| Data / database consequence | Two migrations: add column + backfill + index (reversible, additive), then the unique index (also droppable, but by then the data has been edited per account, and edits to account rows are not automatically reversible). |
| Development complexity | The code is small (a copy of the pattern already used for usernames). The real work is the per-account list, which is administrative work, not engineering. |
| Maintenance complexity | Low afterwards: the database itself now prevents a new duplicate, which is what the rule is for. |
| Potential downside | It cannot complete without you. If the account list stalls, uniqueness stalls, and the intermediate state ("half the duplicates fixed") is the state most likely to confuse someone later. |
| If postponed | Nothing breaks: today's refusal-on-ambiguity already protects the login path. What stays exposed is the whole-table credential read, and that is fixed by the normalization half, which does not need this decision. |
| Blocks other phases | Only Phase 5's second migration (`032`) and Phase 9's row for the same read. Nothing else in the plan waits on it. |

### Option 2B — Keep uniqueness as a future requirement; defer the migration until an operational remediation process exists

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Don't add the rule yet. First get a routine where a new duplicate is spotted and handled as part of normal operations, then apply the rule." |
| Changes in NABIN | Normalized column + index + the safer lookup ship; the constraint is explicitly deferred; whatever process you build for catching duplicates becomes the prerequisite. |
| Customer app | No change. |
| Driver app | No change. |
| Merchant / admin | Nothing changes for anyone's login. New admins can still be created with a duplicated or absent number, because nothing prevents it. |
| Security consequence | The ambiguity *refusal* keeps working (it is code, not a constraint), so no admin can log in by an ambiguous number either way. What you do without the constraint is *detection at write time*: a typo that copies an existing number is accepted silently and discovered later, by the process rather than by the database. |
| Data / database consequence | One migration instead of two. The 50 duplicates and the 380 blank phones remain exactly as they are. |
| Development complexity | Lowest of the two, and it is the only option that does not require you to name 50 outcomes before anything else moves. |
| Maintenance complexity | Transfers the job from the database to a person and a report. If the report is generated and nobody reads it, duplicates accumulate with no signal. |
| Potential downside | Duplicate-prone state becomes the permanent state. Re-counting the table later will show more shared numbers, not fewer, and each one is an identity question someone has to answer. |
| If postponed | Same as choosing this option — it is the postponement path, made explicit and documented. The main cost is that the deferral needs an owner (who decides it is over), or it is indefinite. |
| Blocks other phases | Nothing. It deliberately unblocks Phase 5's first half. |

**The line that is common to both options:** the normalized column, the index, the database-side lookup and
the removal of password material from the login read happen in either case. The question in front of you is
only about **when the uniqueness rule is added and what has to be true before it can be**.

---

# Question 3 — Audit mirror

**What is actually there.** Audit records are written to the `audit_logs` table (**28,938** rows). When the
server starts, it loads a **copy of the newest 200** rows into its own memory and keeps adding to that copy
as things happen. That memory copy is the "mirror". If the database becomes unreachable, the admin
dashboard is served from the mirror — and it presents **the length of that 200-row list as the total**,
with no label saying "this is a partial, possibly stale copy". There is **no compliance consumer and no
security-investigation consumer of this data anywhere in the code** — no export, no report, no second
reader. The dashboard's loader reads only the `logs` array and discards errors silently. Four example rows
fabricated for early development sit in the mirror permanently and are shown as if they were real history.
And a genuine code defect (a function looked up in the wrong scope during boot) means those first 200
mirror rows are not mapped properly, which is what produces `Invalid Date` and `'System'` in the table.
**That defect is an implementation bug. It is not a decision for you, and neither option below accepts it
or requires you to tolerate it.**

### Option 3A — The mirror is a convenience view; authoritative investigation uses the authoritative records

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "The dashboard's audit list is a quick look. If we ever need to prove what happened — to a regulator, an auditor, or in an incident — we go to the real table." |
| Changes in NABIN | The mirror gets an honest label ("showing a bounded copy, read as of time X, N rows of M"), the dashboard shows it, the misleading "immutable record of all compliance decisions" copy is reduced to what is actually held, and the boot-time defect is fixed. |
| Customer app | No change (there is no customer-facing audit at all). |
| Driver app | No change. |
| Merchant / admin | An admin looking at the audit tab sees a stated bound instead of a number that looks complete. During a database outage they still see something useful, and it says what it is. |
| Security consequence | Removes a real failure mode — a partial list read as the whole list — without pretending the partial list is evidence. An investigator following the label goes to `audit_logs`, which has all 28,938 rows. |
| Data / database consequence | None. No schema, no row changes. The mirror stays 200 rows at boot unless its loading is separately widened. |
| Development complexity | Low to medium. It is labelling, ordering and copy work in a handful of files, plus the scope fix for the boot mapping. |
| Maintenance complexity | Low. Once the label exists, it stays true. |
| Potential downside | Whoever eventually does need to answer a compliance question must have a way to read the real table (operator SQL, or a filterable route). This option does not build that path; it only points at it. |
| If postponed | The current state persists: an unlabelled partial list presented under a claim of completeness, and 200 mis-mapped rows in it. |
| Blocks other phases | Nothing, and it is the option that lets Phase 7 finish. The three sub-questions it leaves open (which error code the two routes use, what happens to the 4 fake rows, which un-awaited writes become awaited) stay open either way. |

### Option 3B — The mirror itself must become authoritative/complete enough for investigations

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "The thing admins look at must be provably the whole story by itself, so nobody has to go to the database to answer a compliance question." |
| Changes in NABIN | The boot load stops being a fixed 200 rows and becomes a complete, key-by-keyed read with a verified count; rejected/failed writes can no longer be missing from the mirror or present in it wrongly; the routes have to answer during outages from a set that is actually whole. |
| Customer app | No change. |
| Driver app | No change. |
| Merchant / admin | The audit tab becomes trustworthy as evidence, including during a database outage. |
| Security consequence | What this option claims is completeness *of the mirror*. Note it does not *create* missing records: an audit write that failed at the database and was not awaited is missing from both places, and no completeness rule in the mirror can recover it. Completeness of the mirror and completeness of the record are different claims. |
| Data / database consequence | No schema change, but a standing read of ~28,938 rows (growing) at every boot, plus whatever retention you decide applies. Memory and query cost scale with the table, not with the recent activity. |
| Development complexity | Medium to high: full hydration, ordering of store-write against mirror-write, awaiting or queueing the 20 un-awaited writes, a completeness assertion that survives a mid-load failure. |
| Maintenance complexity | Higher and permanent. Every future growth of `audit_logs` (it is currently the largest of the tables in this review) is a boot-time cost, and someone has to decide the retention bound. |
| Potential downside | Cost and fragility at scale, for a consumer that does not exist today. It builds an evidence-grade facility that no one in the repository has asked for in code. |
| If postponed | Same as 3A's postponement — and nothing about postponing makes 3B cheaper later; the table only grows. |
| Blocks other phases | Phase 7 grows, and Phase 9's completeness rule gets a much larger read to certify. |

### Option 3C — Other

Use the blank line in `docs/OWNER_SECURITY_CLARIFICATIONS.md`. Practical variants people ask for, stated
only so they are available and not because any is suggested: mirror for the dashboard and refuse for
anything labelled compliance; keep 3A's labelling and add a bounded "last N days" window; or defer the
whole question until a compliance consumer is actually built (which is a postponement with a reason
attached).

**The fact that decides between A and B is not technical.** It is this: *is there a real, named obligation
in your operation that will be discharged by looking at that dashboard tab?* If yes, B is the only one that
can carry it. If no, A costs less and B buys a property nothing uses.

---

# Question 4 — Geo cache and the 30-second window

**What a TTL is, with two servers and one changed fence.** Say you draw a new "Airport T3 closed for
works, +₹200" boundary on the admin map and save it. Each running server keeps its own in-memory copy of
the boundaries so it does not have to read the database for every fare quote. Server A received your save,
so it re-reads immediately. **Server B never hears about it** — nothing tells it. Without a TTL, Server B
quotes the old geography until it is restarted. That is the ₹330-against-₹984 disagreement found earlier:
two servers, same coordinates, different prices.

A **30-second TTL** means Server B is allowed to be at most 30 seconds behind: its copy has an age, and
either a background tick or a check before a price is quoted re-reads it once it is older than 30 seconds.
The cost of one re-read is small and measured: two database round-trips, because all 447 fences and 445
rules each fit in one page today.

**The measured complication, which is what the question is about.** You named four operations that must not
run on stale geography. Three of them **do not consult geography at all** in the code path you named:
driver assignment, cancellation/refund, and parcel booking (whose request carries no coordinates). Only
fare calculation and ride booking actually ask the geography engine anything. So a rule that says "those
three must not use stale geography" has nothing to attach to — there is no geography read in them to make
fresh.

### Option 4A — Apply the 30-second window only to operations that actually consume geo data

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Fix the staleness exactly where the price is actually being computed from geography, and write down plainly that the other three operations never look at geography." |
| Changes in NABIN | Quotes and the public geo verdict re-read geography when their copy is older than 30 seconds, instead of waiting for a restart. Two servers converge on the same coordinates' price within the window. |
| Customer app | A fare quote is at most 30 seconds behind the map you drew. A ride booked seconds after you change a boundary is priced off the new one. |
| Driver app | No change — dispatch reads no geography today and this option does not make it start. |
| Merchant / admin | Your fence edit takes effect platform-wide within ~30 seconds instead of "when each server next restarts". You still see the effect immediately in your own console. |
| Security consequence | Removes a price-disagreement window that a caller could exploit by repeatedly quoting against a boundary you are changing. |
| Data / database consequence | None. No schema, no rows. Two extra page reads per refresh, bounded by the window; the refresh must be written so 20 simultaneous quotes cause one re-read, not 20. |
| Development complexity | Medium, and bounded: one age check, one background tick (the pattern already exists for sessions, on a 15-second timer), one refuse-rather-than-price path. |
| Maintenance complexity | Low. The rule is one constant. If geography ever grows past one page, the existing keyset walk handles it. |
| Potential downside | Three of the four operations you protected stay unprotected in the literal sense that they consult nothing — the protection is recorded as "not applicable", which can be mistaken for "done". |
| If postponed | The staleness remains unbounded: an old server keeps its old pricing indefinitely, which is the finding that produced this decision. |
| Blocks other phases | Nothing, and it is the version Phase 3 can build immediately. It leaves one note to fix in passing: changing the platform-wide surge multiplier does not currently trigger any re-read. |

### Option 4B — Also establish the same policy for future geo-aware versions of those operations

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Same as 4A now, and it also becomes a standing rule: the day dispatch or refunds start using geography, they inherit the 30-second policy automatically." |
| Changes in NABIN | 4A's behaviour, plus a written rule that any future geo-reading critical operation must be built on the same freshness contract (and a small code hook that exists already and is unused — a "booking-critical" label in the engine). |
| Customer app | No immediate change. Later, if parcel booking starts sending coordinates, the fare would come from geography no older than 30 seconds — and parcel prices would change for the first time, because they currently ignore geography entirely. |
| Driver app | No immediate change. Later, geo-aware dispatch could refuse to assign on unverifiable geography, which is a new way for a dispatch to fail. |
| Merchant / admin | No immediate change. Later, your boundary edits constrain which drivers can be assigned, which is a new kind of power and a new kind of outage. |
| Security consequence | Prevents the common failure where a new geo-reading feature is built on the old, unbounded cache. Today's state is that nothing stops that happening. |
| Data / database consequence | None now. Later: more reads on the hot paths, and any new coordinates on parcel requests are new persisted data on job rows. |
| Development complexity | Low now (write the rule, wire the existing label). The cost lands later, on whichever feature makes those operations geo-aware. |
| Maintenance complexity | A written rule needs someone to enforce it at review time. Without the hook wired, rules of this kind quietly rot. |
| Potential downside | A forward commitment about behaviour nobody has designed yet. It may bind a future feature to a freshness contract that suits pricing but not dispatch, where refusing to assign for 30 seconds is a worse outcome than assigning on slightly old data. |
| If postponed | Today nothing changes either way — the operations are not geo-aware. What gets lost by postponing is only the rule, so a future feature can be written against it rather than discovering it. |
| Blocks other phases | Nothing. It cannot block, because it asks for no behaviour change now. |

### Option 4C — Other

Practical variants available for the blank line: a different window than 30 seconds (the cost curve is
known — a shorter window is more frequent re-reads, a longer one a wider disagreement); no cache at all for
critical operations, which is a per-quote database read; or explicitly deciding that dispatch must never
consult geography, which closes the question in the opposite direction.

**What is deliberately not invented here.** No geography has been added to driver assignment, cancellation
or refund in order to make your four-item list fit the code. If those three should become geo-aware, that
is a pricing and dispatch behaviour change with its own consequences, and it is asked as a separate line in
the clarifications document.

---

# Question 5 — The public pricing door

**What is at stake, concretely.** There are two anonymous doors that answer questions about our internal
geography and margin. One is `POST /api/geofence/evaluate` — the admin console's map tester uses it, no app
does, and its reply includes each zone's surcharge and multiplier. The other is
`POST /api/pricing/estimate` — **the customer app's real quote call**, which takes any coordinates you put
in the body and returns the full surcharge-inclusive fare a rider would pay there. This question is about
the second door. The first one's split is already decided; the point of the measurement is that **closing
the first does not close the second**, so the "no public pricing oracle" property is still standing with one
leg in the air. Also relevant: there is **no rate-limiting machinery in this backend at all** — nothing
currently stops one caller asking this question as often as it likes.

Two things to keep in mind while reading the options. **Pricing transparency works both ways**: a quote an
outsider can request freely is also a quote a customer can request before signing in. And **abuse value is
mostly systematic**: one request tells an attacker almost nothing; a grid of 10,000 requests maps our
boundary shapes and reconstructs our rate card, at the exact coordinates a competitor cares about.

### Option 5A — Require authentication for `POST /api/pricing/estimate`

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Only a signed-in customer or driver may ask what a trip would cost." |
| Changes in NABIN | The route gains a session gate. A competitor or scraper with no account can no longer ask it anything. |
| Customer app | The app already signs users in, and its quote call is in the same service class as its authenticated calls — so the signed-in flow keeps working after one header is added. What breaks is any **pre-login** quote: a visitor browsing without an account no longer sees a price before signing in. Whether that journey exists today is a product question, and the answer is not in this repository's code. |
| Driver app | No change — drivers do not call it. |
| Merchant / admin | No change. |
| Security consequence | Removes the door entirely for anonymous callers. Also removes the "no throttle exists" problem in one move, since an authenticated caller carries an identity that can be suspended. |
| Data / database consequence | None. The session table grows a little from more customer sign-ins if guests must register to see a price — that is the interesting second-order effect, not the change itself. |
| Development complexity | Small in the backend (the customer session gate exists and is the only one that checks the store). Non-zero in the app, if a pre-login quote screen is real. |
| Maintenance complexity | Low. |
| Potential downside | It can push anonymous users toward creating accounts to see a price, which is a conversion cost nobody measured. It also does not stop a registered user — or a script that registers — from walking a coordinate grid, so the oracle shrinks rather than disappears. |
| If postponed | The anonymous fare read continues at unlimited rate. It is not made worse by waiting, and no other work is made harder by waiting. |
| Blocks other phases | Nothing. It is the same routing decision as Phase 2 and should be built with it, since both ask "who may hear this answer". |

### Option 5B — Keep it public, but redesign the response so it cannot act as an oracle

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "Anyone may ask, but the answer gives away less: enough for a person to decide, not enough to reverse-engineer the rate card." |
| Changes in NABIN | The estimate payload is reshaped. The knobs available, stated as facts about the data rather than as a proposal: the base fare / per-km / per-minute / booking-fee breakdown, the surcharge amount, the surge multiplier, which zone matched, and the window each rule fired under. Removing the zone attribution is the option with the least customer impact and the most oracle damage, because attribution is what a grid search reads. Removing the fare breakdown is the opposite. |
| Customer app | Depends how far the redesign goes. A total-only answer is invisible to a customer who already knows what they are paying. Hiding the surcharge line is visible: "why is this more than usual" stops being answerable in-app, and support asks increase. |
| Driver app | No change. |
| Merchant / admin | The admin console keeps its own richer view (that route's audience is already decided separately), so operators lose nothing. |
| Security consequence | Reduces the value of mass querying rather than preventing it. An anonymous caller can still learn "this point costs ₹X" — that is the product feature. What becomes hard is learning *why*, which is the part that reconstructs boundaries. |
| Data / database consequence | None. |
| Development complexity | Medium, and wider than it looks: the shape of this response is asserted by existing test files and rendered by the app, so a change touches backend, tests and client together. |
| Maintenance complexity | A redesigned payload needs writing down, because "what may an anonymous caller see" becomes a deliberate list that every later field addition has to respect. |
| Potential downside | It needs a decision about every field in the payload, and it narrows what an anonymous caller learns rather than closing the door: the endpoint stays public, with less in the answer. Pricing transparency to the customer drops if fields are removed from what they see. |
| If postponed | The current, fully-explanatory payload stays public. |
| Blocks other phases | Nothing, though it is the option most likely to touch three surfaces at once and so the one most likely to be sequenced with Phase 2. |

### Option 5C — Keep it public deliberately and accept the risk

| Line | Consequence |
| --- | --- |
| Meaning in simple language | "We want anyone to be able to price a trip without an account. We understand that this lets outsiders learn our rates and boundaries, and we accept that as the price of that feature." |
| Changes in NABIN | Nothing changes in behaviour. What changes is that the property is recorded as **accepted**, so a later reader cannot mistake it for an oversight — and the "no public pricing oracle" line in the plan stays marked NOT SATISFIED *by choice*. |
| Customer app | No change. The browse-before-signing-in quote keeps working exactly as it does now. |
| Driver app | No change. |
| Merchant / admin | No change. |
| Security consequence | The exposure continues as measured: an anonymous caller can obtain the surcharge-inclusive fare for arbitrary coordinates, at unbounded rate, because no throttle exists. The practical abuse is systematic mapping (competitor rate reconstruction; boundary inference; and pricing reconnaissance before fraud such as targeting where surcharges make cancellation profitable). |
| Data / database consequence | None now. If abuse appears later, the mitigation available without an auth change is a throttle — which would be new infrastructure in this codebase. |
| Development complexity | Zero. |
| Maintenance complexity | Zero, with one exception: the accepted-risk note has to be revisited if boundaries or margins ever become commercially sensitive, or if a partner contract says they are. |
| Potential downside | Reversal gets harder later, because public surfaces attract dependencies — apps, partner integrations or SEO pages start assuming an anonymous quote exists, and taking it away then costs more than taking it away now. |
| If postponed | Postponing is behaviourally identical to 5C today, and different on paper: no record says it was considered. |
| Blocks other phases | Nothing. |

### Option 5D — Other

Available for the blank line: public for a bounded set (one free quote per device/session, which needs an
issued-token budget), public with a throttle added as new infrastructure, or "public for browsing,
authenticated for the exact number" — a two-tier estimate. Each of these is a change to what an anonymous
visitor may do, so each is a product decision first and an engineering decision second.

**Two facts that hold for all four options.** `POST /api/geofence/evaluate`'s split is already decided and
unaffected by your answer here. And no matter which you pick, **no rate-limiting exists in this codebase
today** — the OTP limiter is OTP-only and the `ENABLE_RATE_LIMITING` flag in `.env.production.example` is
read by no code — so "add a throttle" is not a configuration switch, it is new machinery.

---

# OWNER DECISION INPUT

Write the letter (or letters) of your choice next to each line. Do it here, or in
`docs/OWNER_SECURITY_CLARIFICATIONS.md`, whichever is easier — the clarification document is the record;
this one is the explanation.

1. Geo cleanup: ______
2. Admin phone duplicates: ______
3. Audit mirror: ______
4. Geo cache: ______
5. Public pricing estimate: ______

Optional one-line rationale per decision, if you want the reasoning attached to the letter:
______________________________________________________________

**NO IMPLEMENTATION AUTHORIZED.**

No source file, test, schema object, migration, database row, configuration value, hosted environment,
commit, push or deployment was touched in producing this explanation, and none is authorized by it. The
five questions above stay open until the owner answers them in writing.
