/**
 * NABIN — Phase 8 Forensic Security Tests
 * Tests verify all findings from the Phase 8 Forensic Security Audit.
 */

const { Client } = require('pg');
const assert = require('assert');

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  NABIN — Phase 8 Forensic Security Test Suite');
  console.log('══════════════════════════════════════════════════════════\n');

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 1: audit_logs Append-Only Enforcement (Finding 1: CRITICAL)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('GROUP 1: audit_logs Append-Only Enforcement');

  let auditRowId;

  await test('audit_logs: INSERT succeeds (append is permitted)', async () => {
    const res = await client.query(
      `INSERT INTO public.audit_logs
         (admin_id, admin_name, role, action, module, target_entity_type, target_entity_id)
       VALUES ('TEST_AGENT', 'Test Agent', 'SYSTEM', 'TEST_INSERT', 'TESTING', 'TEST', 'phase8-test')
       RETURNING id`
    );
    auditRowId = res.rows[0].id;
    assert.ok(auditRowId, 'Expected inserted row ID');
  });

  await test('audit_logs: UPDATE is blocked by trigger (append-only)', async () => {
    if (!auditRowId) throw new Error('No audit row to test against');
    try {
      await client.query(
        `UPDATE public.audit_logs SET action = 'TAMPERED' WHERE id = $1`,
        [auditRowId]
      );
      throw new Error('UPDATE should have been blocked but was not');
    } catch (err) {
      if (err.message.includes('audit_logs is append-only')) {
        // Expected — trigger fired correctly
        return;
      }
      throw err;
    }
  });

  await test('audit_logs: DELETE is blocked by trigger (append-only)', async () => {
    if (!auditRowId) throw new Error('No audit row to test against');
    try {
      await client.query(
        `DELETE FROM public.audit_logs WHERE id = $1`,
        [auditRowId]
      );
      throw new Error('DELETE should have been blocked but was not');
    } catch (err) {
      if (err.message.includes('audit_logs is append-only')) {
        // Expected — trigger fired correctly
        return;
      }
      throw err;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 2: adjust_wallet_atomic anon/authenticated access (Finding 2: CRITICAL)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 2: adjust_wallet_atomic Privilege Restrictions');

  await test('adjust_wallet_atomic: anon role CANNOT execute', async () => {
    const res = await client.query(
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') as exec
       FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public' AND p.proname = 'adjust_wallet_atomic' LIMIT 1`
    );
    assert.strictEqual(res.rows[0].exec, false, 'anon should NOT have EXECUTE on adjust_wallet_atomic');
  });

  await test('adjust_wallet_atomic: authenticated role CANNOT execute', async () => {
    const res = await client.query(
      `SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') as exec
       FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public' AND p.proname = 'adjust_wallet_atomic' LIMIT 1`
    );
    assert.strictEqual(res.rows[0].exec, false, 'authenticated should NOT have EXECUTE on adjust_wallet_atomic');
  });

  await test('adjust_wallet_atomic: service_role CAN execute', async () => {
    const res = await client.query(
      `SELECT has_function_privilege('service_role', p.oid, 'EXECUTE') as exec
       FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public' AND p.proname = 'adjust_wallet_atomic' LIMIT 1`
    );
    assert.strictEqual(res.rows[0].exec, true, 'service_role MUST have EXECUTE on adjust_wallet_atomic');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 3: SECURITY DEFINER RPCs (Finding 3: HIGH)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 3: SECURITY DEFINER RPC Privilege Restrictions');

  const secdefFunctions = [
    'accept_dispatch_offer_atomic',
    'accept_job_assignment_atomic',
    'cancel_ride_atomic',
    'redeem_promotion_atomic',
    'validate_promotion_preview'
  ];

  for (const fn of secdefFunctions) {
    await test(`${fn}: anon CANNOT execute`, async () => {
      const res = await client.query(
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') as exec
         FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND p.proname = $1 LIMIT 1`,
        [fn]
      );
      assert.strictEqual(res.rows[0].exec, false, `anon should NOT have EXECUTE on ${fn}`);
    });

    await test(`${fn}: authenticated CANNOT execute`, async () => {
      const res = await client.query(
        `SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') as exec
         FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND p.proname = $1 LIMIT 1`,
        [fn]
      );
      assert.strictEqual(res.rows[0].exec, false, `authenticated should NOT have EXECUTE on ${fn}`);
    });

    await test(`${fn}: service_role CAN execute`, async () => {
      const res = await client.query(
        `SELECT has_function_privilege('service_role', p.oid, 'EXECUTE') as exec
         FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND p.proname = $1 LIMIT 1`,
        [fn]
      );
      assert.strictEqual(res.rows[0].exec, true, `service_role MUST have EXECUTE on ${fn}`);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 4: notifications RLS Policy (Finding 4: HIGH)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 4: notifications RLS Policy Hardening');

  await test('notifications: legacy "Users view own notifications" policy is REMOVED', async () => {
    const res = await client.query(
      `SELECT polname FROM pg_policy
       JOIN pg_class ON pg_class.oid = pg_policy.polrelid
       WHERE pg_class.relname = 'notifications'
       AND polname = 'Users view own notifications'`
    );
    assert.strictEqual(res.rows.length, 0, 'Legacy policy with (user_id IS NULL) USING clause should be removed');
  });

  await test('notifications: active read policy uses recipient_user_id scope', async () => {
    const res = await client.query(
      `SELECT polname, pg_get_expr(polqual, polrelid) as using_expr
       FROM pg_policy
       JOIN pg_class ON pg_class.oid = pg_policy.polrelid
       WHERE pg_class.relname = 'notifications'
       AND polname = 'p_user_read_own_notifications'`
    );
    assert.ok(res.rows.length > 0, 'p_user_read_own_notifications policy must exist');
    assert.ok(res.rows[0].using_expr.includes('recipient_user_id'), 'Policy must include recipient_user_id check');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 5: support_tickets RLS Policy (Finding 5: HIGH)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 5: support_tickets RLS Policy Hardening');

  await test('support_tickets: legacy "Admins view all support tickets" ALL policy is REMOVED', async () => {
    const res = await client.query(
      `SELECT polname FROM pg_policy
       JOIN pg_class ON pg_class.oid = pg_policy.polrelid
       WHERE pg_class.relname = 'support_tickets'
       AND polname = 'Admins view all support tickets'`
    );
    assert.strictEqual(res.rows.length, 0, 'Broad ALL policy must be replaced with split policies');
  });

  await test('support_tickets: granular admin SELECT policy exists', async () => {
    const res = await client.query(
      `SELECT polname, polcmd FROM pg_policy
       JOIN pg_class ON pg_class.oid = pg_policy.polrelid
       WHERE pg_class.relname = 'support_tickets'
       AND polname = 'p_admin_select_support_tickets'`
    );
    assert.ok(res.rows.length > 0, 'p_admin_select_support_tickets policy must exist');
    assert.strictEqual(res.rows[0].polcmd, 'r', 'Policy must be SELECT only (r)');
  });

  await test('support_tickets: admin UPDATE policy with WITH CHECK exists', async () => {
    const res = await client.query(
      `SELECT polname, polcmd, pg_get_expr(polwithcheck, polrelid) as with_check
       FROM pg_policy
       JOIN pg_class ON pg_class.oid = pg_policy.polrelid
       WHERE pg_class.relname = 'support_tickets'
       AND polname = 'p_admin_update_support_tickets'`
    );
    assert.ok(res.rows.length > 0, 'p_admin_update_support_tickets policy must exist');
    assert.strictEqual(res.rows[0].polcmd, 'w', 'Policy must be UPDATE (w)');
    assert.ok(res.rows[0].with_check, 'Policy must have a WITH CHECK clause');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 6: Trigger Integrity
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 6: Trigger Integrity');

  await test('audit_logs: trg_audit_logs_immutable trigger exists and fires BEFORE UPDATE', async () => {
    const res = await client.query(
      `SELECT trigger_name, event_manipulation, action_timing
       FROM information_schema.triggers
       WHERE event_object_schema = 'public'
       AND event_object_table = 'audit_logs'
       AND trigger_name = 'trg_audit_logs_immutable'`
    );
    assert.ok(res.rows.length >= 1, 'Trigger must exist');
    const updateTrigger = res.rows.find(r => r.event_manipulation === 'UPDATE');
    const deleteTrigger = res.rows.find(r => r.event_manipulation === 'DELETE');
    assert.ok(updateTrigger, 'Must fire on UPDATE');
    assert.ok(deleteTrigger, 'Must fire on DELETE');
    assert.strictEqual(updateTrigger.action_timing, 'BEFORE', 'Must be BEFORE trigger');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 7: All Tables Still Have RLS Enabled
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 7: RLS Coverage Integrity');

  await test('All public tables still have RLS enabled after migration 022', async () => {
    const res = await client.query(
      `SELECT pt.tablename
       FROM pg_tables pt
       JOIN pg_class pc ON pc.relname = pt.tablename
       JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
       WHERE pt.schemaname = 'public'
       AND pc.relrowsecurity = false
       ORDER BY pt.tablename`
    );
    assert.strictEqual(res.rows.length, 0, `Tables without RLS: ${res.rows.map(r => r.tablename).join(', ')}`);
  });

  // Clean up test row from audit_logs (note: row was inserted, but we cannot delete it now due to our trigger)
  // This is expected behavior — the trigger correctly prevents cleanup.
  // The test INSERT will remain as a permanent record.

  await client.end();

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err.message);
  process.exit(1);
});
