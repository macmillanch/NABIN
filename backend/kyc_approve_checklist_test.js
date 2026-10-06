/*
 * KYC APPROVE must not be possible without explicit verification evidence.
 *
 * The defect this file was written for: `reviewIdentityApplication` gated the checklist on
 * `if (checklist && …)`, so an APPROVE that simply omits the checklist skipped validation
 * entirely - and that same branch marks the documents VERIFIED and the account ACTIVE. A guard
 * that only applies when the caller volunteers the evidence is not a guard.
 *
 * Scope is the repository-level contract, deliberately: it runs in-process against a synthetic
 * application pushed into the in-memory list, so no seeded or real applicant is ever mutated and
 * no table shape is guessed. `getUser()` returns nothing for the synthetic userId, which also
 * keeps the user rows untouched on the success paths.
 *
 * Every refusal is asserted on its actual message and on the application being left unchanged:
 * "not approved" has to mean the record still says what it said, not merely a falsy reply.
 */
process.env.NABIN_TEST_MODE = 'true';
const fs = require('fs');
const path = require('path');
const db = require('./src/database');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const APP_ID = 'op-kyc-approve-probe';
const REFUSAL = 'Cannot approve application without confirming that the declared details match and that both supplied identity numbers were checked.';

function freshApp(overrides = {}) {
  const app = {
    id: APP_ID, userId: 'no-such-user-for-probe', userName: 'Probe Persona', phone: '0000000000',
    status: 'PENDING', overallDocumentStatus: 'NO_DOCUMENT', aadhaarDocStatus: 'NO_DOCUMENT', voterIdDocStatus: 'NO_DOCUMENT',
    aadhaarDocUrl: null, voterIdDocUrl: null,
    reviewNotes: '', rejectionReason: '', resubmissionReason: '', ...overrides,
  };
  db.identityApplications = (db.identityApplications || []).filter(a => a.id !== APP_ID);
  db.identityApplications.push(app);
  return app;
}

const ok = (r) => Boolean(r && r.success);
const refusedWith = (r, text) => !ok(r) && String(r.error || '').includes(text);

(async () => {
  // --- APPROVE without the checklist: the defect -------------------------------------------
  let app = freshApp();
  const missing = await db.reviewIdentityApplication(APP_ID, 'APPROVE', 'probe: no checklist supplied', undefined, 'admin-probe', 'Probe Admin');
  check('AP-01', refusedWith(missing, REFUSAL), `APPROVE with no checklist is refused with the documented message (got ${JSON.stringify(missing).slice(0, 140)})`);
  check('AP-02', app.status === 'PENDING' && app.overallDocumentStatus === 'NO_DOCUMENT' && app.aadhaarDocStatus === 'NO_DOCUMENT',
    `and the application is left untouched, not silently verified (status=${app.status}, docs=${app.aadhaarDocStatus}/${app.voterIdDocStatus})`);

  // --- APPROVE with a partial checklist ---------------------------------------------------
  app = freshApp();
  const partial = await db.reviewIdentityApplication(APP_ID, 'APPROVE', 'probe: partial checklist', { infoMatches: true, aadhaarValid: true, voterIdValid: false }, 'admin-probe', 'Probe Admin');
  check('AP-03', refusedWith(partial, REFUSAL), `APPROVE with voterIdValid false is refused (${JSON.stringify(partial).slice(0, 100)})`);

  // --- APPROVE with truthy strings instead of booleans -------------------------------------
  app = freshApp();
  const strings = await db.reviewIdentityApplication(APP_ID, 'APPROVE', 'probe: truthy strings', { infoMatches: 'true', aadhaarValid: 'yes', voterIdValid: 1 }, 'admin-probe', 'Probe Admin');
  check('AP-04', refusedWith(strings, REFUSAL), `'true'/'yes'/1 are not verification evidence and must not approve (${JSON.stringify(strings).slice(0, 110)})`);
  check('AP-05', app.status === 'PENDING', `and the status stayed ${app.status}`);

  // --- APPROVE with a genuinely complete checklist still works ------------------------------
  app = freshApp();
  const good = await db.reviewIdentityApplication(APP_ID, 'APPROVE', 'probe: all checks pass', { infoMatches: true, aadhaarValid: true, voterIdValid: true }, 'admin-probe', 'Probe Admin');
  check('AP-06', ok(good) && app.status === 'VERIFIED'
    && app.aadhaarDocStatus === 'NO_DOCUMENT' && app.voterIdDocStatus === 'NO_DOCUMENT' && app.overallDocumentStatus === 'NO_DOCUMENT',
    `a fully true checklist still verifies the identity, and still says there is no document (success=${ok(good)}, status=${app.status}, docs=${app.aadhaarDocStatus}/${app.voterIdDocStatus}/${app.overallDocumentStatus})`);
  check('AP-07', app.rejectionReason === '' && app.resubmissionReason === '' && app.reviewNotes === 'probe: all checks pass',
    'and the notes/clearing behaviour is unchanged');

  // The default note an approval writes when the officer supplies no reason used to read
  // "Manual verification checks passed. Documents validated." - a record, in the platform's own
  // words, that documents were validated. NABIN holds none, and #147 made the route refuse a
  // document claim outright, so the default can only state what the decision actually covered.
  app = freshApp();
  const noReason = await db.reviewIdentityApplication(APP_ID, 'APPROVE', '', { infoMatches: true, aadhaarValid: true, voterIdValid: true }, 'admin-probe', 'Probe Admin');
  check('AP-13', ok(noReason) && app.status === 'VERIFIED'
    && /declared details/i.test(app.reviewNotes) && /numbers/i.test(app.reviewNotes)
    && !/document[s]? (were )?(validated|verified|checked)/i.test(app.reviewNotes),
    `an approval with no reason notes what was reviewed, and never that a document passed (${JSON.stringify(app.reviewNotes)})`);

  // --- REJECT and REQUEST_RESUBMISSION decide the application, not a document ----------------
  app = freshApp();
  const rejNoReason = await db.reviewIdentityApplication(APP_ID, 'REJECT', '   ', undefined, 'admin-probe', 'Probe Admin');
  check('AP-08', refusedWith(rejNoReason, 'A mandatory rejection reason is required.'), `REJECT without a reason is still refused (${JSON.stringify(rejNoReason).slice(0, 90)})`);
  const rej = await db.reviewIdentityApplication(APP_ID, 'REJECT', 'the declared name does not match the account record', undefined, 'admin-probe', 'Probe Admin');
  check('AP-09', ok(rej) && app.status === 'REJECTED'
    && app.rejectionReason === 'the declared name does not match the account record'
    && app.overallDocumentStatus === 'NO_DOCUMENT' && app.aadhaarDocStatus === 'NO_DOCUMENT',
    `REJECT with a reason still works, and does not reject a document that was never filed (status=${app.status}, docs=${app.overallDocumentStatus})`);

  app = freshApp();
  const rrNoReason = await db.reviewIdentityApplication(APP_ID, 'REQUEST_RESUBMISSION', '', undefined, 'admin-probe', 'Probe Admin');
  check('AP-10', refusedWith(rrNoReason, 'A mandatory resubmission instruction is required.'), `REQUEST_RESUBMISSION without a reason is still refused (${JSON.stringify(rrNoReason).slice(0, 90)})`);
  const rr = await db.reviewIdentityApplication(APP_ID, 'REQUEST_RESUBMISSION', 'confirm your legal name and submit again', undefined, 'admin-probe', 'Probe Admin');
  check('AP-11', ok(rr) && app.status === 'RESUBMISSION_REQUIRED'
    && app.resubmissionReason === 'confirm your legal name and submit again'
    && app.overallDocumentStatus === 'NO_DOCUMENT' && app.voterIdDocStatus === 'NO_DOCUMENT',
    `REQUEST_RESUBMISSION still asks the customer for their details, not for a new copy of a file (status=${app.status}, docs=${app.overallDocumentStatus})`);

  // --- An unknown decision is still refused, and nothing is mutated -------------------------
  app = freshApp();
  const bogus = await db.reviewIdentityApplication(APP_ID, 'MAKE_IT_SO', 'x', undefined, 'admin-probe', 'Probe Admin');
  check('AP-12', !ok(bogus) && app.status === 'PENDING', `an unknown decision is refused and changes nothing (${JSON.stringify(bogus).slice(0, 90)}, status=${app.status})`);

  // Leave the probe out of the in-memory list so a later case in this process cannot see it.
  db.identityApplications = (db.identityApplications || []).filter(a => a.id !== APP_ID);

  // --- SUB: a document is SUBMITTED only when one was actually sent (task #146) --------------
  //
  // Same scope as every case above — the repository, in-process, with a synthetic applicant no
  // route can reach. This is the other half of the gate: `reviewIdentityApplication` refuses to
  // verify without evidence, but the *writer* used to manufacture that evidence on the way in.
  // `POST /api/identity/submit` defaulted a missing upload to `/docs/mock_aadhaar_user.png` and
  // this function hard-coded 'SUBMITTED' for both documents and the overall status, so a customer
  // who typed two numbers into a form left a record saying NABIN held paperwork it had never
  // received. The numbers are still what the route validates; the file is now what the record
  // claims, and it claims nothing that was not sent.
  const SUB_USER = 'no-such-user-for-doc-probe';
  const stripProbe = () => {
    db.identityApplications = (db.identityApplications || []).filter(a => a.userId !== SUB_USER);
    db.users = (db.users || []).filter(u => u.id !== SUB_USER);
  };
  stripProbe();

  const sub1 = db.submitIdentityApplication({
    userId: SUB_USER, name: 'Probe Persona', phone: '0000000000',
    aadhaarNumber: '111122223334', voterIdNumber: 'ABC12346'
  });
  const a1 = sub1.application;
  check('SUB-01', a1.aadhaarDocUrl === null && a1.voterIdDocUrl === null,
    `a submission that sent no file stores no document path (aadhaar=${JSON.stringify(a1.aadhaarDocUrl)}, voter=${JSON.stringify(a1.voterIdDocUrl)})`);
  check('SUB-02', a1.aadhaarDocStatus === 'NO_DOCUMENT' && a1.voterIdDocStatus === 'NO_DOCUMENT' && a1.overallDocumentStatus === 'NO_DOCUMENT',
    `and says so in all three places rather than promising a document that is still to come (${a1.aadhaarDocStatus}/${a1.voterIdDocStatus}/${a1.overallDocumentStatus})`);
  // The two numbers are real input and stay recorded; only the document claim was false.
  check('SUB-03', Boolean(a1.aadhaarNumberMasked) && Boolean(a1.voterIdNumberMasked) && a1.status === 'IDENTITY_VERIFICATION_PENDING',
    `the numbers the customer typed are still recorded, masked (${a1.aadhaarNumberMasked}/${a1.voterIdNumberMasked})`);

  // #146 chose 'PENDING' for an absent file because the writer still accepted one. #147 then made
  // the route refuse any document claim, so the derivation could only ever produce 'PENDING' - a
  // word that promises a file is on its way, on a platform with no way to send one. The writer no
  // longer reads the fields at all, so the claim cannot be re-introduced from a caller that ignores
  // the route's refusal and calls the repository directly.
  const sub2 = db.submitIdentityApplication({
    userId: SUB_USER, isResubmission: true,
    aadhaarNumber: '111122223334', voterIdNumber: 'ABC12346',
    aadhaarDocUrl: 'https://storage.example/aadhaar-probe.jpg',
    voterIdDocUrl: 'https://storage.example/voterid-probe.jpg'
  });
  const a2 = sub2.application;
  check('SUB-04', a2.aadhaarDocUrl === null && a2.voterIdDocUrl === null,
    `a caller that hands the writer two document URLs records neither (aadhaar=${JSON.stringify(a2.aadhaarDocUrl)}, voter=${JSON.stringify(a2.voterIdDocUrl)})`);
  check('SUB-05', a2.aadhaarDocStatus === 'NO_DOCUMENT' && a2.voterIdDocStatus === 'NO_DOCUMENT' && a2.overallDocumentStatus === 'NO_DOCUMENT',
    `and no status in the record reads as a filed document (${a2.aadhaarDocStatus}/${a2.voterIdDocStatus}/${a2.overallDocumentStatus})`);
  check('SUB-06', a2.id === a1.id && a2.status === 'IDENTITY_VERIFICATION_PENDING',
    `the resubmission still updates the same application, numbers and all (id=${a2.id}, ${a2.aadhaarNumberMasked}/${a2.voterIdNumberMasked})`);

  stripProbe();

  // The fabricated paths are gone from the shipped source, not just from this call. Comments are
  // stripped first, on the CT-07 precedent: the ruling is written down as prose that quotes the
  // retired literals, and grepping prose would make the suite red for documenting itself.
  const stripComments = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // The Admin dashboard is shipped source too. Its examiner panel hard-pointed both document
  // frames, the zoom viewer and a dead dispute modal at `/docs/mock_*_rahul.png`, so the writer
  // being clean proved nothing about what the human reading the queue was shown (task #147).
  const mockInCode = ['src/server.js', 'src/database.js', '../admin_dashboard.html']
    .map((f) => [f, /\/docs\/mock[A-Za-z0-9_.-]*/.exec(stripComments(fs.readFileSync(path.join(__dirname, f), 'utf8')))])
    .filter(([, m]) => m);
  check('SUB-07', mockInCode.length === 0,
    mockInCode.length ? `a mock document path is still reachable as code: ${mockInCode.map(([f, m]) => `${f} ${m[0]}`).join(', ')}`
      : 'no route, writer or the examiner\'s own screen hands out a mock document path any more');

  const failed = results.filter(r => !r.ok);
  console.log('\n====================================================');
  console.log(`KYC APPROVE CHECKLIST GATE  ${results.length - failed.length} PASSED, ${failed.length} FAILED, 0 SKIPPED`);
  failed.forEach(f => console.log(`   ❌ [${f.id}] ${f.detail}`));
  console.log('====================================================');
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.log('FATAL ' + e.message + '\n' + e.stack); process.exitCode = 1; });
