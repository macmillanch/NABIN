const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const crypto = require('crypto');
const { supabaseAdmin, isConfigured, isLivePostgres, checkSupabaseConnection } = require('../src/supabase');
const db = require('../src/database');

/**
 * Authoritative PostgreSQL Persistence Verification Suite
 * Verifies User, Driver, Job, and Wallet/Ledger CRUD + RPC in local PostgreSQL.
 */
async function runVerification() {
  console.log('=================================================================');
  console.log('🧪 NABIN — AUTHORITATIVE POSTGRESQL PERSISTENCE VERIFICATION');
  console.log('=================================================================\n');

  if (!isConfigured || !isLivePostgres) {
    console.error('❌ Aborted: Local Supabase PostgreSQL is not configured or SUPABASE_POSTGRES_LIVE is not true.');
    console.error(`   isConfigured: ${isConfigured}, isLivePostgres: ${isLivePostgres}`);
    process.exit(1);
  }

  // Pre-flight connection test
  const health = await checkSupabaseConnection();
  if (!health.connected) {
    console.error('❌ Failed to connect to local Supabase PostgreSQL:', health.error);
    process.exit(1);
  }
  console.log('✅ Local Supabase connection confirmed healthy.');

  // Initialize DB state
  await db.initPostgres();
  console.log('✅ Initialized database repositories with PostgreSQL authority.\n');

  // Unique test identifiers to prevent collision and allow safe cleanup
  const runId = Date.now().toString().slice(-6) + '_' + Math.random().toString(36).slice(2, 6);
  const testUserUuid = crypto.randomUUID();
  const testUserPhone = '+97798' + Math.floor(10000000 + Math.random() * 90000000);
  const testDriverUuid = crypto.randomUUID();
  const testDriverPhone = '+97797' + Math.floor(10000000 + Math.random() * 90000000);
  const testJobNumber = `TEST-JOB-${runId}`;
  const testTopupIdemKey = `idem_topup_${runId}`;
  const testDebitIdemKey = `idem_debit_${runId}`;
  const testRefId = `ref_${runId}`;

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedTests++;
    console.log(`  ✅ PASSED: ${message}`);
  }

  try {
    // -------------------------------------------------------------
    // 1. USER PERSISTENCE VERIFICATION
    // -------------------------------------------------------------
    console.log('-------------------------------------------------------------');
    console.log('👤 1. USER PERSISTENCE (public.users)');
    console.log('-------------------------------------------------------------');

    // 1.1 Insert User
    const createdUser = await db.userRepo.create({
      id: testUserUuid,
      name: `Test User ${runId}`,
      phone: testUserPhone,
      email: `test_${runId}@nabin.internal`,
      role: 'customer'
    });
    assert(createdUser && createdUser.id === testUserUuid, 'User created in PostgreSQL with UUID primary key');

    // 1.2 Read User
    const fetchedById = await db.userRepo.findByIdAsync(testUserUuid);
    assert(fetchedById && fetchedById.name === `Test User ${runId}`, 'User read by findByIdAsync returns authoritative data');

    const fetchedByPhone = await db.userRepo.findByPhoneAsync(testUserPhone);
    assert(fetchedByPhone && fetchedByPhone.id === testUserUuid, 'User read by findByPhoneAsync returns authoritative data');

    // 1.3 Update User
    const updatedUser = await db.userRepo.update(testUserUuid, {
      name: `Test User Updated ${runId}`,
      identity_status: 'VERIFIED'
    });
    assert(updatedUser && updatedUser.name === `Test User Updated ${runId}`, 'User updated authoritative in-memory state');

    // 1.4 Persistence After Reconnect / Bypass Cache
    const { data: dbUser, error: userDbErr } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', testUserUuid)
      .single();
    assert(!userDbErr && dbUser && dbUser.name === `Test User Updated ${runId}` && dbUser.identity_status === 'VERIFIED',
      'User updates physically verified directly in PostgreSQL public.users');

    // -------------------------------------------------------------
    // 2. DRIVER PERSISTENCE VERIFICATION
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('🚗 2. DRIVER PERSISTENCE (public.drivers)');
    console.log('-------------------------------------------------------------');

    // 2.1 Insert Driver
    const createdDriver = await db.driverRepo.create({
      id: testDriverUuid,
      user_id: testUserUuid,
      name: `Test Driver ${runId}`,
      phone: testDriverPhone,
      vehicle_type: 'car',
      status: 'offline'
    });
    assert(createdDriver && createdDriver.id === testDriverUuid, 'Driver created in PostgreSQL with UUID primary key');

    // 2.2 Read Driver
    const fetchedDriver = await db.driverRepo.findByIdAsync(testDriverUuid);
    assert(fetchedDriver && fetchedDriver.name === `Test Driver ${runId}`, 'Driver read by findByIdAsync returns authoritative data');

    // 2.3 Update Driver Status
    const updatedDriver = await db.driverRepo.update(testDriverUuid, {
      status: 'online',
      is_online: true
    });
    assert(updatedDriver && updatedDriver.status === 'online', 'Driver status updated to online');

    // 2.4 Driver Telemetry Heartbeat Persistence
    const updatedLoc = await db.driverRepo.updateLocation(testDriverUuid, {
      latitude: 27.7172,
      longitude: 85.3240,
      bearing: 180.0
    });
    assert(updatedLoc && updatedLoc.location && updatedLoc.location.lat === 27.7172, 'Driver location updated via repository');

    // 2.5 Persistence After Reconnect
    const { data: dbDriver, error: driverDbErr } = await supabaseAdmin
      .from('drivers')
      .select('*')
      .eq('id', testDriverUuid)
      .single();
    assert(!driverDbErr && dbDriver && dbDriver.is_online === true && parseFloat(dbDriver.current_lat) === 27.7172,
      'Driver physically verified directly in PostgreSQL public.drivers');

    // -------------------------------------------------------------
    // 3. JOB PERSISTENCE & ATOMIC TRANSITIONS
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('📦 3. JOB PERSISTENCE & ATOMIC TRANSITIONS (public.jobs)');
    console.log('-------------------------------------------------------------');

    // 3.1 Create Job
    const createdJob = await db.jobRepo.create({
      id: testJobNumber,
      type: 'RIDE',
      customerId: testUserUuid,
      driverId: null,
      fare: 450.0,
      status: 'REQUESTED',
      pickup: { address: 'Test Pickup Landmark', lat: 27.7172, lng: 85.3240 },
      drop: { address: 'Test Drop Landmark', lat: 27.7200, lng: 85.3300 }
    });
    assert(createdJob && (createdJob.jobNumber === testJobNumber || createdJob.id === testJobNumber),
      'Job created in PostgreSQL with job_number');

    // 3.2 Read Job
    const fetchedJob = await db.jobRepo.findByIdAsync(testJobNumber);
    assert(fetchedJob && fetchedJob.status === 'REQUESTED', 'Job read by findByIdAsync returns REQUESTED state');

    // 3.3 Valid Atomic State Transition: REQUESTED -> SEARCHING
    const jobStep1 = await db.jobRepo.updateStatus(testJobNumber, 'SEARCHING');
    assert(jobStep1 && jobStep1.status === 'SEARCHING', 'Atomic conditional transition REQUESTED -> SEARCHING succeeded');

    // 3.4 Valid Atomic State Transition: SEARCHING -> ASSIGNED
    const jobStep2 = await db.jobRepo.updateStatus(testJobNumber, 'ASSIGNED', testDriverUuid);
    assert(jobStep2 && jobStep2.status === 'ASSIGNED', 'Atomic conditional transition SEARCHING -> ASSIGNED succeeded');

    // 3.5 Invalid State Transition (Prevented Race Condition)
    let invalidTransitionFailed = false;
    try {
      // ASSIGNED cannot transition directly back to REQUESTED
      await db.jobRepo.updateStatus(testJobNumber, 'REQUESTED');
    } catch (err) {
      invalidTransitionFailed = true;
    }
    assert(invalidTransitionFailed, 'Invalid state transition ASSIGNED -> REQUESTED correctly rejected by atomic WHERE check');

    // 3.6 Valid Transition to COMPLETED
    await db.jobRepo.updateStatus(testJobNumber, 'ACCEPTED');
    await db.jobRepo.updateStatus(testJobNumber, 'DRIVER_ARRIVING');
    await db.jobRepo.updateStatus(testJobNumber, 'DRIVER_ARRIVED');
    await db.jobRepo.updateStatus(testJobNumber, 'IN_TRANSIT');
    const completedJob = await db.jobRepo.updateStatus(testJobNumber, 'COMPLETED', null, { paymentStatus: 'PAID' });
    assert(completedJob && completedJob.status === 'COMPLETED', 'Job reached COMPLETED state through valid lifecycle path');

    // 3.7 Physical Verification in PostgreSQL
    const { data: dbJob, error: jobDbErr } = await supabaseAdmin
      .from('jobs')
      .select('*')
      .eq('job_number', testJobNumber)
      .single();
    assert(!jobDbErr && dbJob && dbJob.status === 'COMPLETED' && dbJob.payment_status === 'PAID',
      'Job final status physically verified directly in PostgreSQL public.jobs');

    // -------------------------------------------------------------
    // 4. WALLET & DOUBLE-ENTRY LEDGER (adjust_wallet_atomic RPC)
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('💳 4. WALLET & DOUBLE-ENTRY LEDGER (adjust_wallet_atomic RPC)');
    console.log('-------------------------------------------------------------');

    // 4.1 Credit / Topup Wallet via adjust_wallet_atomic
    const topupAmount = 1000.00;
    const topupResult = await db.ledgerRepo.adjustWallet({
      ownerId: testUserUuid,
      ownerType: 'CUSTOMER',
      amount: topupAmount,
      category: 'WALLET_TOPUP',
      description: `Integration test wallet topup ${runId}`,
      referenceId: testRefId,
      debitAccount: 'PAYMENT_GATEWAY_ESCROW',
      creditAccount: 'CUSTOMER_WALLET_LIABILITY',
      idempotencyKey: testTopupIdemKey
    });

    assert(topupResult && topupResult.success === true && topupResult.status === 'POSTED',
      'adjust_wallet_atomic successfully executed with status POSTED');
    assert(Number(topupResult.balance) === topupAmount,
      `User wallet balance updated to exact credited amount (${topupAmount})`);

    // 4.2 Verify Physical User Wallet Balance in PostgreSQL
    const { data: userAfterTopup } = await supabaseAdmin
      .from('users')
      .select('wallet_balance')
      .eq('id', testUserUuid)
      .single();
    assert(Number(userAfterTopup.wallet_balance) === topupAmount,
      'Physical users.wallet_balance verified in PostgreSQL matches topup');

    // 4.3 Verify Journal Transaction Created
    const { data: journalTxn, error: jTxnErr } = await supabaseAdmin
      .from('journal_transactions')
      .select('*')
      .eq('idempotency_key', testTopupIdemKey)
      .single();
    assert(!jTxnErr && journalTxn && journalTxn.status === 'POSTED',
      'journal_transactions record created with POSTED status');
    assert(Number(journalTxn.total_debit) === topupAmount && Number(journalTxn.total_credit) === topupAmount,
      'journal_transactions has balanced total_debit === total_credit');

    // 4.4 Verify Double-Entry Journal Lines (Debit & Credit)
    const { data: journalLines, error: jLinesErr } = await supabaseAdmin
      .from('journal_lines')
      .select('*')
      .eq('journal_id', journalTxn.id);
    assert(!jLinesErr && journalLines && journalLines.length === 2,
      'Exactly 2 journal_lines inserted for double-entry bookkeeping');

    const debitLine = journalLines.find(l => l.entry_type === 'DEBIT');
    const creditLine = journalLines.find(l => l.entry_type === 'CREDIT');
    assert(debitLine && Number(debitLine.amount) === topupAmount && debitLine.account_code === 'PAYMENT_GATEWAY_ESCROW',
      'DEBIT line matches amount and debit account');
    assert(creditLine && Number(creditLine.amount) === topupAmount && creditLine.account_code === 'CUSTOMER_WALLET_LIABILITY',
      'CREDIT line matches amount and credit account');

    // 4.5 Idempotency Protection Verification
    const duplicateTopup = await db.ledgerRepo.adjustWallet({
      ownerId: testUserUuid,
      ownerType: 'CUSTOMER',
      amount: topupAmount,
      category: 'WALLET_TOPUP',
      description: `Duplicate topup attempt`,
      referenceId: testRefId,
      debitAccount: 'PAYMENT_GATEWAY_ESCROW',
      creditAccount: 'CUSTOMER_WALLET_LIABILITY',
      idempotencyKey: testTopupIdemKey // Same key
    });
    assert(duplicateTopup && duplicateTopup.status === 'IDEMPOTENT_SKIPPED',
      'adjust_wallet_atomic correctly returned IDEMPOTENT_SKIPPED on replay');
    assert(Number(duplicateTopup.balance) === topupAmount,
      'Wallet balance remained unchanged after idempotent replay (no double crediting)');

    // 4.6 Negative Balance Protection Verification
    let negativeBalanceBlocked = false;
    try {
      // Attempt to deduct 5000 from 1000 balance
      await db.ledgerRepo.adjustWallet({
        ownerId: testUserUuid,
        ownerType: 'CUSTOMER',
        amount: -5000.00,
        category: 'WALLET_TOPUP',
        description: `Overdraft deduction attempt`,
        referenceId: `overdraft_${runId}`,
        debitAccount: 'CUSTOMER_WALLET_LIABILITY',
        creditAccount: 'PAYMENT_GATEWAY_ESCROW',
        idempotencyKey: `overdraft_idem_${runId}`
      });
    } catch (err) {
      negativeBalanceBlocked = true;
    }
    assert(negativeBalanceBlocked, 'Negative wallet balance deduction was rejected and rolled back by PostgreSQL RPC');

    // Confirm balance is still 1000 in DB
    const { data: userAfterFailedDeduct } = await supabaseAdmin
      .from('users')
      .select('wallet_balance')
      .eq('id', testUserUuid)
      .single();
    assert(Number(userAfterFailedDeduct.wallet_balance) === topupAmount,
      'Wallet balance remained intact after rejected overdraft deduction');

    // 4.7 Valid Atomic Deduction (Debit)
    const debitAmount = 400.00;
    const debitResult = await db.ledgerRepo.adjustWallet({
      ownerId: testUserUuid,
      ownerType: 'CUSTOMER',
      amount: -debitAmount,
      category: 'WALLET_TOPUP',
      description: `Valid deduction ${runId}`,
      referenceId: testRefId,
      debitAccount: 'CUSTOMER_WALLET_LIABILITY',
      creditAccount: 'PAYMENT_GATEWAY_ESCROW',
      idempotencyKey: testDebitIdemKey
    });
    const expectedRemaining = topupAmount - debitAmount;
    assert(debitResult && Number(debitResult.balance) === expectedRemaining,
      `Valid deduction calculated correct remaining balance (${expectedRemaining})`);

    const { data: userAfterValidDebit } = await supabaseAdmin
      .from('users')
      .select('wallet_balance')
      .eq('id', testUserUuid)
      .single();
    assert(Number(userAfterValidDebit.wallet_balance) === expectedRemaining,
      'Authoritative users.wallet_balance verified in PostgreSQL after deduction');

    console.log('\n=============================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} INTEGRATION TESTS PASSED IN POSTGRESQL!`);
    console.log('=============================================================');
  } finally {
    // -------------------------------------------------------------
    // 5. TEARDOWN & CLEANUP (FINALLY BLOCK)
    // -------------------------------------------------------------
    console.log('\n🧹 Performing Safe Cleanup of Test Artifacts...');
    try {
      // 1. Delete test journal entries (Cascade deletes journal_lines)
      await supabaseAdmin
        .from('journal_transactions')
        .delete()
        .or(`idempotency_key.eq.${testTopupIdemKey},idempotency_key.eq.${testDebitIdemKey}`);

      // 2. Delete test jobs
      await supabaseAdmin
        .from('jobs')
        .delete()
        .eq('job_number', testJobNumber);

      // 3. Delete test drivers
      await supabaseAdmin
        .from('drivers')
        .delete()
        .eq('id', testDriverUuid);

      // 4. Delete test users
      await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', testUserUuid);

      console.log('✅ Test artifacts cleaned up safely. Non-test data untouched.\n');
    } catch (cleanupErr) {
      console.warn('⚠️ Warning during test cleanup:', cleanupErr.message);
    }
  }
}

runVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Suite failed with unhandled error:', err.message);
    process.exit(1);
  });
