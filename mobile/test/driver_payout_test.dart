import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/driver_router.dart';
import 'package:mobile/features/auth/presentation/screens/driver_login_screen.dart';
import 'package:mobile/features/earnings/presentation/screens/driver_earnings_screen.dart';
import 'package:mobile/features/payout/presentation/screens/driver_payout_screen.dart';

import 'support/http_stub.dart';

// D15 regression lock: the Driver payout-destination screen is bound to exactly two routes and to
// nothing else —
//   GET  /api/driver/earnings                      (server.js:6226, payout block at :6210-6216)
//   POST /api/driver/payout-destination/request    (server.js:5805, DriverRepository.js:646-697)
// Both were probed with live DRIVER sessions on 2026-10-08; every status code asserted here is a
// code the probe actually observed.
//
// The VPAs in this file are synthetic handles (`partner.*@okstub`) invented for the stub, the same
// way D18's `TCK-TEST-…` references are. They exist so the assertions can prove the screen echoes
// *which* value the platform sent. Nothing here is offered as a real payout address.
//
// The screen's most important negative claim is that there is no payout history to read: no Driver
// route selects from `driver_payouts`, so the tests below hold the screen to saying so instead of
// rendering amounts, dates, references or the non-durable `transactions` field the earnings read
// still carries.

const String kEarningsPath = '/api/driver/earnings';
const String kRequestPath = '/api/driver/payout-destination/request';
const String kVerifiedVpa = 'partner.verified@okstub';
const String kPendingVpa = 'partner.pending@okstub';
const String kNewVpa = 'partner.requested@okstub';

/// The `payout` block exactly as `buildDriverEarningsPayload` projects it (`server.js:6210-6216`).
Map<String, dynamic> _payoutBlock({
  String? destination,
  bool destinationVerified = false,
  String? pendingDestination,
  Object? destinationCoolingUntil,
  Object? kycStatus = 'VERIFIED',
}) {
  return <String, dynamic>{
    'destination': destination,
    'destinationVerified': destinationVerified,
    'pendingDestination': pendingDestination,
    'destinationCoolingUntil': destinationCoolingUntil,
    'kycStatus': kycStatus,
    'operationalStatus': 'AVAILABLE',
  };
}

/// One answer to `GET /api/driver/earnings`, with only the keys D15 is allowed to look at.
Map<String, dynamic> _earningsBody({
  Map<String, dynamic>? payout,
  String source = 'postgres',
  bool success = true,
  String? error,
}) {
  return <String, dynamic>{
    'success': success,
    'source': source,
    if (payout != null) 'payout': payout,
    if (error != null) 'error': error,
  };
}

typedef _Reply = (int status, Map<String, dynamic> body);

/// Answers the earnings read from a queue — the last entry repeats — and the destination request
/// with `post` when one is given. The driver-home read is answered too, because the Account
/// integration test reaches D15 through the screen that calls it.
void _serve({required List<_Reply> reads, _Reply? post}) {
  var index = 0;
  stubHandler = (method, url, _) {
    final path = url.path;
    if (method == 'GET' && path.endsWith(kEarningsPath)) {
      final reply = reads[index < reads.length ? index : reads.length - 1];
      index++;
      return (reply.$1, jsonEncode(reply.$2));
    }
    if (method == 'POST' && path.endsWith(kRequestPath)) {
      final reply = post ?? (200, {'success': true, 'pendingUpiId': kNewVpa, 'status': 'PENDING_VERIFICATION'});
      return (reply.$1, jsonEncode(reply.$2));
    }
    if (method == 'GET' && path.endsWith('/driver/home')) {
      return (200, jsonEncode({
        'success': true,
        'driver': <String, dynamic>{'name': 'Test Partner', 'isOnline': false, 'kycStatus': 'VERIFIED'},
      }));
    }
    return (200, '{"success":true}');
  };
}

List<String> _paths([String? method]) => stubSeen
    .where((s) => method == null || s.startsWith('$method '))
    .map((s) => Uri.parse(s.substring(s.indexOf(' ') + 1)).path)
    .toList();

/// The bodies of every request that hit the destination route, oldest first.
List<Map<String, dynamic>> _requestBodies() => stubSeen
    .asMap()
    .entries
    .where((e) => e.value.startsWith('POST ') && e.value.contains(kRequestPath))
    .map((e) => jsonDecode(stubBodies[e.key]) as Map<String, dynamic>)
    .toList();

Map<String, String> _headersFor(String method, String pathFragment) {
  final index = stubSeen.lastIndexWhere(
      (s) => s.startsWith('$method ') && s.contains(pathFragment));
  return index < 0 ? const {} : stubHeaders[index];
}

Map<String, String> _requestHeaders() => _headersFor('POST', kRequestPath);

int _postCount() =>
    stubSeen.where((s) => s.startsWith('POST ') && s.contains(kRequestPath)).length;

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

/// Runs the fake clock far enough for a delayed stub answer to land, so no timer is left pending
/// when the test ends.
Future<void> _drain(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Widget _host(Widget child) => MaterialApp(home: child);

/// A surface tall enough that every row this suite asserts on is actually painted: a `ListView`
/// child below the fold is not in the tree, and `find` would then fail for the wrong reason.
void _tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(800 * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _open(WidgetTester tester) async {
  await tester.pumpWidget(_host(const DriverPayoutScreen()));
  await _settle(tester);
}

Future<void> _pumpRouter(WidgetTester tester, String location) async {
  driverRouter.go(location);
  await tester.pumpWidget(MaterialApp.router(routerConfig: driverRouter));
  await _settle(tester);
}

/// The `d/m/yyyy HH:mm` shape the screen uses for an instant NABIN sent. The test formats the same
/// instant itself, so a painted date can only match by being the server's date.
String _serverStamp(String iso) {
  final at = DateTime.parse(iso).toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(at.day)}/${two(at.month)}/${at.year} ${two(at.hour)}:${two(at.minute)}';
}

Future<void> _submitWith(WidgetTester tester, String vpa) async {
  await tester.enterText(find.byKey(const ValueKey('driver-payout-upi-field')), vpa);
  await tester.pump();
  // `_tall` gives the screen a viewport larger than its content, so the control needs no scroll
  // to be hit: an `ensureVisible` here starts a scroll animation the tap would land mid-flight on.
  await tester.tap(find.byKey(const ValueKey('driver-payout-submit')));
  // The tap's `setState` lands before this call returns, but the tree rebuilds on the next
  // frame: without this pump a test that asserts straight after submitting reads the old frame.
  await tester.pump();
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    SessionManager.instance.saveSession(
      token: 'test-driver-token',
      user: <String, dynamic>{'id': 'drv_test_15', 'name': 'Test Partner', 'role': 'DRIVER'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('the read is GET /api/driver/earnings and nothing else', () {
    testWidgets('a verified destination is the platform\'s value, in its own words',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(
            destination: kVerifiedVpa, destinationVerified: true))),
      ]);

      await _open(tester);

      // An error state would also satisfy "no invented address", so prove the read left.
      expect(_paths('GET'), <String>[kEarningsPath]);
      expect(find.byKey(const ValueKey('driver-payout-verified-state')), findsOneWidget);
      expect(find.text('VERIFIED DESTINATION'), findsOneWidget);
      expect(find.text(kVerifiedVpa), findsOneWidget);
      expect(find.text('VERIFIED on NABIN — payouts can be sent here'), findsOneWidget);
      // Nothing was requested, so there is no pending row and no cooling row.
      expect(find.byKey(const ValueKey('driver-payout-pending-state')), findsNothing);
      expect(find.byKey(const ValueKey('driver-payout-cooling-state')), findsNothing);
    });

    testWidgets('the identity in the read is the bearer token alone — no driver id anywhere',
        (tester) async {
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ]);

      await _open(tester);

      // `GET /api/driver/:driverId/earnings` (server.js:6245) exists and answers 403
      // DRIVER_MISMATCH for another id; D15 must never be able to name one.
      expect(_paths('GET'), <String>[kEarningsPath]);
      for (final url in stubSeen.map((s) => Uri.parse(s.substring(s.indexOf(' ') + 1)))) {
        expect(url.pathSegments, isNot(contains('drv_test_15')),
            reason: 'the signed-in partner\'s id has no business being in a path');
        expect(url.query, isEmpty, reason: 'D15 takes no query parameters at all');
      }
      expect(_headersFor('GET', kEarningsPath)['authorization'], 'Bearer test-driver-token');
    });

    testWidgets('a pending destination is shown as the platform holds it', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(
            destination: null, destinationVerified: false, pendingDestination: kPendingVpa))),
      ]);

      await _open(tester);

      expect(find.byKey(const ValueKey('driver-payout-pending-state')), findsOneWidget);
      expect(find.text('REQUESTED DESTINATION'), findsOneWidget);
      expect(find.text(kPendingVpa), findsOneWidget);
      expect(find.text('NABIN holds this as pending an administrator\'s verification'),
          findsOneWidget);
      // The requested address is not a verified one, and the screen may not blur the two.
      expect(find.text('VERIFIED on NABIN — payouts can be sent here'), findsNothing);
      expect(find.text('NABIN has not verified a destination for you yet'), findsOneWidget);
    });

    testWidgets('no destination on file is stated as such, not as a failure or a blank',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(
            kycStatus: 'PENDING', destinationCoolingUntil: null))),
      ]);

      await _open(tester);

      expect(find.text('No verified payout address on file'), findsOneWidget);
      expect(find.text('NABIN has no verified destination for you yet'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-verified-state')), findsOneWidget);
      // The KYC word is the platform's column, never one this screen inferred.
      expect(find.text('KYC on NABIN: PENDING'), findsOneWidget);
      expect(find.textContaining('KYC VERIFIED'), findsNothing);
    });

    testWidgets('a payload with no payout block is a read that did not answer', (tester) async {
      _serve(reads: [
        (200, _earningsBody()),
      ]);

      await _open(tester);

      // Drawing it as "no destination on file" would be a claim about the platform's data.
      expect(find.text('No verified payout address on file'), findsNothing);
      expect(find.byKey(const ValueKey('driver-payout-verified-state')), findsNothing);
      expect(find.byKey(const ValueKey('driver-payout-retry')), findsOneWidget);
    });

    testWidgets('the cooling period is the instant NABIN sent, formatted not invented',
        (tester) async {
      _tall(tester);
      const until = '2999-01-02T03:04:05.000Z';
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(
            destination: kVerifiedVpa, destinationVerified: true, destinationCoolingUntil: until))),
      ]);

      await _open(tester);

      expect(find.byKey(const ValueKey('driver-payout-cooling-state')), findsOneWidget);
      expect(find.text('Until ${_serverStamp(until)}'), findsOneWidget,
          reason: 'the painted date has to be the server instant in the local zone, nothing else');
    });

    testWidgets('an expired cooling instant mints no row, and no row without one',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(
            destination: kVerifiedVpa,
            destinationVerified: true,
            destinationCoolingUntil: '2001-01-02T03:04:05.000Z'))),
      ]);
      await _open(tester);
      expect(find.byKey(const ValueKey('driver-payout-cooling-state')), findsNothing);
      expect(find.textContaining('cooling'), findsNothing);
    });

    testWidgets('the mirror is labelled as the mirror', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(
            source: 'hydrated-memory', payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))),
      ]);

      await _open(tester);

      expect(find.byIcon(Icons.storage_rounded), findsOneWidget);
      expect(find.textContaining('in-memory mirror (source: hydrated-memory)'), findsOneWidget);
      expect(find.textContaining('durable driver record'), findsOneWidget);
    });

    testWidgets('the read is loading before the answer, not an empty destination',
        (tester) async {
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))),
      ]);
      stubDelay = const Duration(milliseconds: 400);

      await tester.pumpWidget(_host(const DriverPayoutScreen()));
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-upi-field')), findsNothing);
      expect(find.text('No verified payout address on file'), findsNothing);
      // The read left and is still unanswered: the spinner is the only answer it has.
      expect(_paths('GET'), <String>[kEarningsPath]);

      stubDelay = Duration.zero;
      await _drain(tester);
      expect(find.text(kVerifiedVpa), findsOneWidget);
    });

    testWidgets('a 401 read says the session closed, and is not drawn as no destination',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (401, {'success': false, 'error': 'Authentication required.'}),
      ]);

      await _open(tester);

      expect(find.text('Your session has closed'), findsOneWidget);
      expect(find.textContaining('Sign in again to see your payout destination'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-verified-state')), findsNothing);
      expect(find.byKey(const ValueKey('driver-payout-retry')), findsOneWidget);
    });

    testWidgets('a 503 read is a refusal, not an empty destination list', (tester) async {
      _tall(tester);
      _serve(reads: [
        (503, _earningsBody(success: false, error: 'NABIN could not reach the settlement store.')),
      ]);

      await _open(tester);

      expect(find.text('Could not load your payout destination'), findsOneWidget);
      expect(find.textContaining('could not reach the settlement store'), findsOneWidget);
      expect(find.text('No verified payout address on file'), findsNothing);
      expect(find.byKey(const ValueKey('driver-payout-upi-field')), findsNothing);
    });

    testWidgets('no connection keeps its own sentence and invents no status code',
        (tester) async {
      _tall(tester);
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.endsWith(kEarningsPath)) {
          throw const SocketException('stub: nothing is listening');
        }
        return (200, '{"success":true}');
      };

      await _open(tester);

      expect(find.text('Could not load your payout destination'), findsOneWidget);
      expect(find.textContaining('No connection to NABIN'), findsOneWidget);
      expect(find.textContaining('HTTP'), findsNothing,
          reason: 'there was no response, so there is no code to report');
    });

    testWidgets('a failed refresh keeps the rows it already had', (tester) async {
      _tall(tester);
      var reads = 0;
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.endsWith(kEarningsPath)) {
          reads++;
          return reads == 1
              ? (200, jsonEncode(_earningsBody(payout: _payoutBlock(
                  destination: kVerifiedVpa, destinationVerified: true))))
              : (503, jsonEncode(_earningsBody(success: false, error: 'Store unavailable.')));
        }
        return (200, '{"success":true}');
      };

      await _open(tester);
      expect(find.text(kVerifiedVpa), findsOneWidget);

      await tester.tap(find.byIcon(Icons.refresh_rounded));
      await _settle(tester);

      // The destination did not change, so the screen must not imply that it did.
      expect(reads, 2);
      expect(find.text(kVerifiedVpa), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-verified-state')), findsOneWidget);
      expect(find.textContaining('Store unavailable'), findsOneWidget);
    });
  });

  group('the write is POST /api/driver/payout-destination/request with exactly {upiId}', () {
    testWidgets('an accepted request sends the body the route actually takes', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))),
        (200, _earningsBody(payout: _payoutBlock(
            destination: null, destinationVerified: false, pendingDestination: kNewVpa))),
      ]);

      await _open(tester);
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      expect(_paths('POST'), <String>[kRequestPath]);
      expect(_requestBodies(), <Map<String, dynamic>>[
        <String, dynamic>{'upiId': kNewVpa},
      ], reason: 'DriverRepository.js:646 reads `upiId` and nothing else; identity is the token');
      expect(_requestHeaders()['content-type'], contains('application/json'));
    });

    testWidgets('the success message is the platform\'s status, and never claims verification',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))),
        (200, _earningsBody(payout: _payoutBlock(
            destination: null, destinationVerified: false, pendingDestination: kNewVpa))),
      ], post: (200, {
        'success': true,
        'pendingUpiId': kNewVpa,
        'status': 'PENDING_VERIFICATION',
      }));

      await _open(tester);
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      expect(find.byKey(const ValueKey('driver-payout-submitted')), findsOneWidget);
      expect(find.textContaining('NABIN recorded this destination as PENDING_VERIFICATION'),
          findsOneWidget);
      expect(find.textContaining('It is not verified yet'), findsOneWidget);
      expect(find.textContaining('NABIN has not told this app how long'), findsOneWidget);
      // Server-authoritative state: the screen re-read instead of trusting its own POST.
      expect(_paths('GET').length, 2);
      expect(find.text(kVerifiedVpa), findsNothing,
          reason: 'the write un-verified the destination, so the address must leave the verified row');
      expect(find.text('No verified payout address on file'), findsOneWidget);
      // Scoped to the row, not the screen: the input field still holds the typed address, and
      // `find.text` matches an EditableText too, so a bare assertion here would double-count.
      expect(find.descendant(
          of: find.byKey(const ValueKey('driver-payout-pending-state')),
          matching: find.text(kNewVpa)), findsOneWidget);
    });

    testWidgets('the request is explained before it is sent, so no one thinks it is instant',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))),
      ]);

      await _open(tester);

      expect(find.text('Request a different destination'), findsOneWidget);
      expect(
          find.text('Sending a request takes this verified address out of use straight away: '
              'NABIN marks the destination unverified in the same write and will not pay out to '
              'the new one until an administrator verifies it.'),
          findsOneWidget);
      // A pending request already on file has to be named, because a second one replaces it.
      expect(find.textContaining('NABIN keeps no queue of destination requests'), findsNothing);
    });

    testWidgets('a pending request on file warns that another one replaces it', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(pendingDestination: kPendingVpa))),
      ]);

      await _open(tester);

      expect(find.textContaining('A request you already made is still pending'), findsOneWidget);
      expect(find.textContaining('NABIN keeps no queue of destination requests'), findsOneWidget);
    });

    testWidgets('an empty field is refused locally and sends nothing', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ]);

      await _open(tester);
      await _submitWith(tester, '   ');

      expect(find.byKey(const ValueKey('driver-payout-submit-failure')), findsOneWidget);
      expect(find.text('NABIN needs a UPI address to record. Enter one.'), findsOneWidget);
      expect(_postCount(), 0, reason: 'the route would answer 400; no request should leave');
    });

    testWidgets('a malformed address is refused in the route\'s own terms and sends nothing',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ]);

      await _open(tester);
      await _submitWith(tester, 'not-a-vpa');

      expect(find.textContaining('NABIN refused this shape'), findsOneWidget);
      expect(find.textContaining('2-256 characters'), findsOneWidget);
      expect(_postCount(), 0);
    });

    testWidgets('the field caps at the column width, not at the wider regex', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ]);

      await _open(tester);
      final tooLong = '${'a' * 110}@okstub';
      await _submitWith(tester, tooLong);

      final painted = tester.widget<TextField>(
          find.byKey(const ValueKey('driver-payout-upi-field')));
      expect(painted.maxLength, 100,
          reason: 'pending_upi_id is varchar(100) (migration 016:14) although the regex allows 321');
      expect(find.textContaining('NABIN stores a payout address up to 100 characters'),
          findsOneWidget);
    });

    testWidgets('a 400 refusal is quoted, not smoothed over, and claims no change',
        (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ], post: (400, {'success': false, 'error': 'Invalid UPI VPA format.'}));

      await _open(tester);
      // The body is the measured 400 (`server.js` folds every non-OK repository failure into
      // 400), and the address is one this screen's own validation lets through: the point under
      // test is that a refusal arrives as the platform's words, not that the client missed it.
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      expect(_postCount(), 1);
      expect(find.textContaining('NABIN refused this request: Invalid UPI VPA format.'),
          findsOneWidget);
      expect(find.textContaining('Nothing was changed'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-submitted')), findsNothing);
    });

    testWidgets('a 403 KYC refusal is shown as the platform\'s own gate', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(kycStatus: 'PENDING'))),
      ], post: (403, {'success': false, 'code': 'KYC_NOT_VERIFIED', 'error': 'KYC not verified.'}));

      await _open(tester);
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      expect(find.textContaining('NABIN refused this request: KYC not verified.'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-submitted')), findsNothing);
      // No invented remedy: the screen does not promise a KYC route it cannot check.
      expect(find.textContaining('Complete KYC here'), findsNothing);
    });

    testWidgets('a 401 write reports a closed session', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ], post: (401, {'success': false, 'error': 'Authentication required.'}));

      await _open(tester);
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      expect(find.textContaining('Your session with NABIN has closed'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-submitted')), findsNothing);
    });

    testWidgets('rapid taps produce exactly one POST', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
        (200, _earningsBody(payout: _payoutBlock(pendingDestination: kNewVpa))),
      ]);

      await _open(tester);
      // The delay goes in only once the read has landed, so the button exists to tap.
      stubDelay = const Duration(milliseconds: 600);
      await tester.enterText(find.byKey(const ValueKey('driver-payout-upi-field')), kNewVpa);
      await tester.pump();

      final button = find.byKey(const ValueKey('driver-payout-submit'));
      for (var i = 0; i < 6; i++) {
        await tester.tap(button);
        await tester.pump();
      }
      // In flight: the field is locked and the control shows a spinner, not a second chance.
      expect(tester.widget<TextField>(find.byKey(const ValueKey('driver-payout-upi-field'))).enabled,
          isFalse);
      expect(find.byType(CircularProgressIndicator), findsWidgets);

      await _drain(tester);
      stubDelay = Duration.zero;
      await _settle(tester);

      expect(_postCount(), 1, reason: 'this route has no idempotency key — a second POST is a '
          'second write, not a retry');
      expect(_requestBodies(), <Map<String, dynamic>>[
        <String, dynamic>{'upiId': kNewVpa},
      ]);
    });

    testWidgets('an ambiguous transport failure is never shown as success', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ]);
      final served = stubHandler;
      stubHandler = (method, url, body) {
        if (method == 'POST' && url.path.endsWith(kRequestPath)) {
          throw const SocketException('stub: the answer never came back');
        }
        return served(method, url, body);
      };

      await _open(tester);
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      expect(_postCount(), 1);
      expect(find.byKey(const ValueKey('driver-payout-submitted')), findsNothing);
      expect(find.textContaining('could not be confirmed'), findsOneWidget);
      expect(
          find.textContaining('check what NABIN holds as your pending'),
          findsOneWidget,
          reason: 'with no idempotency key the only safe instruction is to look before sending');
      // And it must not silently re-send on its own.
      expect(_postCount(), 1);
    });

    testWidgets('a 5xx write refuses without pretending the row moved', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))),
      ], post: (500, {'success': false}));

      await _open(tester);
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      expect(find.textContaining('NABIN could not complete the request just now'), findsOneWidget);
      expect(find.textContaining('Nothing was changed'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-payout-submitted')), findsNothing);
      // The verified address it had before is still what is painted.
      expect(find.text(kVerifiedVpa), findsOneWidget);
    });
  });

  group('payout history: there is no read, so there is nothing to render', () {
    testWidgets('the screen says history is unavailable and shows no rows', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))),
      ]);

      await _open(tester);

      expect(find.byKey(const ValueKey('driver-payout-history-unavailable')), findsOneWidget);
      expect(find.text('Payout history'), findsOneWidget);
      expect(find.textContaining('Payout history isn\'t available in the Driver app yet'),
          findsOneWidget);
      expect(find.textContaining('no amounts, dates or references to show'), findsOneWidget);
      expect(find.byType(ListTile), findsNothing);
    });

    testWidgets('not one rupee, date, reference or bank name appears anywhere', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(
            destination: kVerifiedVpa,
            destinationVerified: true,
            pendingDestination: kPendingVpa))),
      ]);

      await _open(tester);

      final painted = tester.widgetList<Text>(find.byType(Text))
          .map((t) => t.data ?? '')
          .join('\n');
      // A substring scan would flag "Sending" for "ending", so the bank-claim probes are phrases.
      for (final forbidden in [
        '₹', 'HDFC', 'SBI', 'ICICI', 'Axis', 'Bank', 'TXN', 'Central Hub', 'Delhi', 'Aizawl',
        'Imphal', 'MZ-01', '504', 'GATEWAY_TIMEOUT', 'Paid every Friday', 'account ending',
      ]) {
        expect(painted.contains(forbidden), isFalse,
            reason: 'D15 painted "$forbidden", which no backend response contained');
      }
    });

    testWidgets('the non-durable transactions field is refused even when the read ships it',
        (tester) async {
      _tall(tester);
      // `GET /api/driver/earnings` really does carry this key: `transactions: driverTx`
      // (`server.js:6218`) is the filtered `db.transactions` array, and `db.transactions` is
      // literals seeded at `database.js:1176` and never re-read from PostgreSQL
      // (`database.js:2913-2919`). The object below is that seeded payout row, field for field,
      // so the test fails if this screen ever starts trusting it.
      final body = _earningsBody(payout: _payoutBlock(destination: kVerifiedVpa, destinationVerified: true))
        ..['transactions'] = <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'TXN-904',
            'type': 'PAYOUT',
            'jobId': null,
            'userId': 'drv_1',
            'userRole': 'DRIVER',
            'driverId': 'drv_1',
            'title': 'Instant UPI Payout to HDFC Bank',
            'amount': -1200.0,
            'platformFee': 0.0,
            'commission': 0.0,
            'deliveryFee': 0.0,
            'net': -1200.0,
            'mode': 'UPI_DIRECT',
            'paymentStatus': 'SUCCESS',
            'settlementStatus': 'COMPLETED',
            'time': 'Yesterday 08:00 PM',
          },
        ];
      _serve(reads: [(200, body)]);

      await _open(tester);

      expect(find.textContaining('Instant UPI Payout'), findsNothing);
      expect(find.text('TXN-904'), findsNothing);
      expect(find.textContaining('1,200'), findsNothing);
      expect(find.textContaining('1200'), findsNothing);
      expect(find.textContaining('Yesterday 08:00 PM'), findsNothing);
      expect(find.textContaining('₹'), findsNothing);
      expect(find.byKey(const ValueKey('driver-payout-history-unavailable')), findsOneWidget);
    });

    testWidgets('no history-shaped request is ever made', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ], post: (403, {'success': false, 'error': 'KYC not verified.'}));

      await _open(tester);
      await _submitWith(tester, kNewVpa);
      await _settle(tester);

      final all = <String>[..._paths('GET'), ..._paths('POST')];
      expect(all, containsAllInOrder(<String>[kEarningsPath, kRequestPath]));
      for (final path in all) {
        expect(path, isNot(contains('history')), reason: 'no such route exists; $path would be a lie');
        expect(path, isNot(contains('payouts')),
            reason: 'driver_payouts is admin-read only (server.js:2118-2160)');
        expect(path, isNot(contains('/finance')),
            reason: 'the finance reads are authenticateAdmin + finance.view');
        // D15 requests a destination; it never disburses anything.
        expect(path, isNot('/api/driver/payout'));
      }
      expect(_postCount(), 1);
    });

    testWidgets('the settled trips are pointed at Earnings, never copied here', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ]);
      // The earnings ledger needs a balance of its own; a read without one is its failure state,
      // which is a different screen's contract and not what this test is about.
      final handler = stubHandler;
      stubHandler = (method, url, body) {
        if (method == 'GET' && url.path.endsWith(kEarningsPath)) {
          final (status, json) = handler(method, url, body);
          final merged = jsonDecode(json) as Map<String, dynamic>
            ..['walletBalance'] = 0
            ..['windows'] = <String, dynamic>{};
          return (status, jsonEncode(merged));
        }
        return handler(method, url, body);
      };

      await _pumpRouter(tester, '/payout');
      expect(find.byKey(const ValueKey('driver-payout-history-unavailable')), findsOneWidget);
      expect(find.textContaining('Your settled trips are listed in Earnings & Settlements'),
          findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('driver-payout-open-earnings')));
      await _settle(tester);

      // The pointer is a real route, not a sentence: the ledger screen is what answers.
      // (D15 stays mounted underneath a `push`, so this only proves the tap landed — the
      // screen's own copy is held to by the assertions above, before the tap.)
      expect(find.byType(DriverEarningsScreen), findsOneWidget);
    });
  });

  group('entry point, navigation and the source itself', () {
    testWidgets('Driver Account\'s payout row opens D15 and nothing else', (tester) async {
      _tall(tester);
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock(
            destination: kVerifiedVpa, destinationVerified: true, pendingDestination: kPendingVpa))),
      ]);

      await _pumpRouter(tester, '/account');
      final row = find.text('Payout destination');
      expect(row, findsOneWidget);
      await tester.ensureVisible(row);
      await tester.pump();
      await tester.tap(row);
      await _settle(tester);

      expect(find.byType(DriverPayoutScreen), findsOneWidget);
      expect(find.text('Payout destination'), findsWidgets, reason: 'the app bar of D15');
      // The request form is on this screen now, which the earnings page never had.
      expect(find.byKey(const ValueKey('driver-payout-upi-field')), findsOneWidget);
      expect(find.text(kVerifiedVpa), findsWidgets);
    });

    testWidgets('a cold deep link to /payout goes through the sign-in gate', (tester) async {
      _serve(reads: [
        (200, _earningsBody(payout: _payoutBlock())),
      ]);

      SessionManager.instance.clearSession();
      await _pumpRouter(tester, '/payout');

      expect(find.byType(DriverLoginScreen), findsOneWidget);
      expect(stubSeen, isEmpty,
          reason: '/payout is not in _driverPublicRoutes, so nothing may be read unauthenticated');
    });

    testWidgets('the screen draws no second API surface and no service credential',
        (tester) async {
      final source = File('lib/features/payout/presentation/screens/driver_payout_screen.dart')
          .readAsStringSync();
      final api = File('lib/core/network/nabin_api_service.dart').readAsStringSync();

      expect(source.contains('HttpRequest'), isFalse);
      expect(source.contains('package:dio'), isFalse);
      expect(source.contains('package:http'), isFalse);
      expect(source.contains('effectiveUrl'), isFalse,
          reason: 'a screen that built its own URL would bypass the two-environment guard');
      for (final file in <String, String>{
        'screen': source,
        'api service': api,
      }.entries) {
        for (final forbidden in [
          'service_role', 'SERVICE_ROLE', 'SUPABASE_SERVICE', 'serviceKey', 'apikey',
          'NABIN_SERVICE',
        ]) {
          expect(file.value.contains(forbidden), isFalse,
              reason: '${file.key} mentions $forbidden');
        }
      }
      // The one method D15 writes through, and the one it must never touch.
      expect(source.contains('NabinApiService.requestPayoutDestination'), isTrue);
      expect(source.contains('requestDriverPayout'), isFalse,
          reason: 'a destination screen that disburses money is not a destination screen');
    });

    testWidgets('390px paints the whole screen without an overflow or an exception',
        (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      _serve(reads: [
        (200, _earningsBody(source: 'hydrated-memory', payout: _payoutBlock(
            destination: kVerifiedVpa,
            destinationVerified: true,
            pendingDestination: kPendingVpa,
            destinationCoolingUntil: '2999-01-02T03:04:05.000Z'))),
      ]);

      await _open(tester);
      final scrollable = find.byType(Scrollable);
      // Reachability is tracked while scrolling down, not asserted at the end: a ListView
      // evicts children outside its cache extent, so dragging back to the top and then looking
      // for the last widgets would fail on the harness rather than on the screen.
      var sawSubmit = false;
      var sawHistory = false;
      for (var i = 0; i < 8; i++) {
        await tester.drag(scrollable.first, const Offset(0, -400));
        await tester.pump(const Duration(milliseconds: 50));
        sawSubmit = sawSubmit ||
            find.byKey(const ValueKey('driver-payout-submit')).evaluate().isNotEmpty;
        sawHistory = sawHistory ||
            find.byKey(const ValueKey('driver-payout-history-unavailable'))
                .evaluate()
                .isNotEmpty;
      }

      expect(tester.takeException(), isNull);
      expect(sawSubmit, isTrue,
          reason: 'the submit control has to be reachable at 390px, not just present');
      expect(sawHistory, isTrue,
          reason: 'the unavailable history card has to be reachable at 390px');
    });
  });
}
