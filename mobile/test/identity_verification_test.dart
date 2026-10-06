import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/auth/presentation/screens/identity_verification_status_screen.dart';
import 'package:mobile/features/auth/presentation/screens/identity_verification_submission_screen.dart';

import 'support/http_stub.dart';

// The identity journey used to be a complete simulation. The form opened already
// filled with a fabricated person — 'Rahul Sharma', DOB 15/08/1994, 'Flat 402,
// Tuikual, Aizawl', a 12-digit Aadhaar and an EPIC number — declared both card
// photos 'attached' and the declaration 'accepted' before the customer touched
// anything, then `Future.delayed(900ms)` navigated to a status screen handed that
// same map. The status screen printed 'XXXX-XXXX-4892' masks the client computed
// itself and offered 'Simulate Approve' / 'Simulate Resubmit' buttons that wrote
// VERIFIED into local state and said so in a snackbar.
//
// `POST /api/identity/submit` and `GET /api/identity/status/:userId` are real
// authenticated routes and had zero callers in this app. So the bar here is the
// wire: the number sent is the number typed, the number shown afterwards is the
// number the platform answered with, and a status only exists because NABIN
// returned one.

const String _userId = 'u_identity_1';

/// The account's own name. The form is allowed to prefill this and nothing else.
const String _sessionName = 'Lalthanmawia Ralte';

/// What the fake server answers for the mask. The digits typed below end in 0123,
/// so a screen that shows 9999 can only have read it from the response — a client
/// computing its own mask cannot pass this.
const String _serverMask = 'XXXX-XXXX-9999';
const String _serverVoterMask = 'MZA***201';

Map<String, dynamic>? _application;
String _identityStatus = 'IDENTITY_VERIFICATION_PENDING';
String? _submitFailure;
String? _readFailure;

/// The values the fake holds for the account, cleared between tests.
void serveIdentity({
  Map<String, dynamic>? application,
  String identityStatus = 'IDENTITY_VERIFICATION_PENDING',
  String? submitFailure,
  String? readFailure,
}) {
  stubReset();
  _application = application;
  _identityStatus = identityStatus;
  _submitFailure = submitFailure;
  _readFailure = readFailure;

  stubHandler = (method, url, body) {
    if (url.path.endsWith('/identity/submit') && method == 'POST') {
      if (_submitFailure != null) {
        return (400, jsonEncode(<String, dynamic>{
          'success': false,
          'error': _submitFailure,
        }));
      }
      final Map<String, dynamic> sent =
          jsonDecode(body) as Map<String, dynamic>;
      _application = <String, dynamic>{
        'id': 'idv_1',
        // The platform's own decision, never the client's.
        'status': 'IDENTITY_VERIFICATION_PENDING',
        // What the writer actually stores after a submission that sent two numbers and no
        // file: the document is not pending, it does not exist. See #154.
        'aadhaarDocStatus': 'NO_DOCUMENT',
        'voterIdDocStatus': 'NO_DOCUMENT',
        'aadhaarNumberMasked': _serverMask,
        'voterIdNumberMasked': _serverVoterMask,
        'submissionDate': '2026-10-03T04:30:00.000Z',
        'updatedAt': '2026-10-03T04:30:00.000Z',
        'resubmissionReason': '',
        'rejectionReason': '',
        // Held so the assertions below can reach what the server was actually sent.
        '_echo': sent,
      };
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'message': 'Your identity details and numbers have been submitted for manual review. No documents were uploaded: NABIN does not accept identity document uploads yet.',
        'application': <String, dynamic>{
          'id': 'idv_1',
          'status': 'IDENTITY_VERIFICATION_PENDING',
          'aadhaarNumberMasked': _serverMask,
        },
      }));
    }

    final int at = url.path.indexOf('/identity/status/');
    if (url.path.contains('/identity/status/') && method == 'GET') {
      if (_readFailure != null) {
        return (400, jsonEncode(<String, dynamic>{
          'success': false,
          'error': _readFailure,
        }));
      }
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'user': <String, dynamic>{
          'id': url.path.substring(at + '/identity/status/'.length),
          'name': _sessionName,
          'phone': '+919876543210',
          'identityStatus': _identityStatus,
        },
        'application': _application,
      }));
    }

    return (404, '{"success":false,"error":"no route"}');
  };
}

/// The real row shape `GET /api/identity/status` returns for a submitted application.
Map<String, dynamic> _appRow({
  String status = 'IDENTITY_VERIFICATION_PENDING',
  String resubmissionReason = '',
  String rejectionReason = '',
}) =>
    <String, dynamic>{
      'id': 'idv_9',
      'status': status,
      // The only document token this platform emits. A review can move `status`; it cannot
      // make a document appear.
      'aadhaarDocStatus': 'NO_DOCUMENT',
      'voterIdDocStatus': 'NO_DOCUMENT',
      'aadhaarNumberMasked': _serverMask,
      'voterIdNumberMasked': _serverVoterMask,
      'submissionDate': '2026-10-03T04:30:00.000Z',
      'updatedAt': '2026-10-04T09:15:00.000Z',
      'resubmissionReason': resubmissionReason,
      'rejectionReason': rejectionReason,
    };

Future<void> pumpJourney(WidgetTester tester, {String initial = '/identity-verification-submit'}) async {
  // The default 800x600 test surface cuts this form off below its own submit
  // button, and a tap on an off-screen button warns and does nothing — which reads
  // as a passing assertion about a request that was never made.
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final router = GoRouter(
    initialLocation: initial,
    routes: <RouteBase>[
      GoRoute(
        path: '/identity-verification-submit',
        builder: (context, state) => const IdentityVerificationSubmissionScreen(),
      ),
      GoRoute(
        path: '/identity-verification-status',
        builder: (context, state) => const IdentityVerificationStatusScreen(),
      ),
      GoRoute(
        path: '/personalization',
        builder: (context, state) => const Scaffold(body: Text('PERSONALIZATION')),
      ),
      GoRoute(
        path: '/home',
        builder: (context, state) => const Scaffold(body: Text('SUPER_APP_HOME')),
      ),
    ],
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  await tester.pump();
}

/// Field order on the form: name, DOB, address, Aadhaar, voter ID.
Future<void> typeField(WidgetTester tester, int index, String text) async {
  await tester.enterText(find.byType(TextFormField).at(index), text);
  await tester.pump();
}

Future<void> tapSubmit(WidgetTester tester) async {
  await tester.tap(find.text('Submit for Admin Verification'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

/// A route change needs the page transition pumped out; one frame leaves the
/// incoming screen unbuilt.
Future<void> tapRouteChange(WidgetTester tester, String label) async {
  await tester.tap(find.text(label));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

Future<void> fillValidForm(WidgetTester tester) async {
  await typeField(tester, 0, 'Zoramthanga Sailo');
  await typeField(tester, 1, '04/02/1991');
  await typeField(tester, 2, 'Zawlkhuai Veng, Aizawl, Mizoram, 796001');
  await typeField(tester, 3, '2345 6789 0123');
  await typeField(tester, 4, 'mzam123456');
  await tester.tap(find.byType(Checkbox));
  await tester.pump();
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    SessionManager.instance.saveSession(
      token: 'stub-session-token',
      user: <String, dynamic>{
        'id': _userId,
        'name': _sessionName,
        'phone': '+919876543210',
      },
    );
    serveIdentity();
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
    stubReset();
  });

  group('the form a customer actually fills', () {
    testWidgets('opens blank except the name on this account', (tester) async {
      await pumpJourney(tester);

      // The person this form used to claim to be.
      expect(find.text('Rahul Sharma'), findsNothing);
      expect(find.text('15/08/1994'), findsNothing);
      expect(find.text('Flat 402, Tuikual, Aizawl, Mizoram, 796001'), findsNothing);
      expect(find.text('234567890123'), findsNothing);
      // Nothing on the wire yet, either: a visit is not a submission.
      expect(stubSeen, isEmpty);

      expect(find.text(_sessionName), findsOneWidget);
    });

    testWidgets('starts with no document and no consent claimed', (tester) async {
      await pumpJourney(tester);

      expect(find.text('Document attached'), findsNothing);
      expect(find.byWidgetPredicate((w) =>
          w is Checkbox && w.value == true), findsNothing);
      // The app has no picker, so the only honest statement about a photo is that
      // there isn't one.
      expect(
        find.textContaining('no document travels with it'),
        findsOneWidget,
      );
    });

    testWidgets('an untouched form refuses instead of sending a stranger',
        (tester) async {
      await pumpJourney(tester);

      await tester.tap(find.text('Submit for Admin Verification'));
      await tester.pump();

      expect(find.text('Aadhaar is 12 digits.'), findsOneWidget);
      expect(stubSaw('POST', '/identity/submit'), isFalse);
    });

    testWidgets('the declaration gates the send', (tester) async {
      await pumpJourney(tester);
      await typeField(tester, 0, 'Zoramthanga Sailo');
      await typeField(tester, 2, 'Zawlkhuai Veng, Aizawl, Mizoram, 796001');
      await typeField(tester, 3, '234567890123');
      await typeField(tester, 4, 'MZAM123456');

      await tapSubmit(tester);

      expect(find.text('Tick the declaration before sending this to NABIN.'),
          findsOneWidget);
      expect(stubSaw('POST', '/identity/submit'), isFalse);
    });

    testWidgets('sends exactly what was typed, under this session id',
        (tester) async {
      await pumpJourney(tester);
      await fillValidForm(tester);
      final submissionCount = stubSeen.length;

      await tapSubmit(tester);

      expect(stubSaw('POST', '/identity/submit'), isTrue);
      // A second submission would have been pressed, not implied by a timer.
      expect(stubSeen.where((s) => s.startsWith('POST ')), hasLength(1));
      expect(stubSeen.length, greaterThan(submissionCount));

      final Map<String, dynamic> sent =
          _application!['_echo'] as Map<String, dynamic>;
      expect(sent['userId'], _userId);
      expect(sent['name'], 'Zoramthanga Sailo');
      expect(sent['dob'], '04/02/1991');
      expect(sent['address'], 'Zawlkhuai Veng, Aizawl, Mizoram, 796001');
      // The digits-only formatter strips the spaces out of the field it was typed in.
      expect(sent['aadhaarNumber'], '234567890123');
      // The screen uppercases the EPIC it sends; the route stores what arrives.
      expect(sent['voterIdNumber'], 'MZAM123456');
      expect(sent['isResubmission'], false);
      // No card photo is claimed, because none can be chosen. The route stores `null` for an
      // absent document since #146, so the client sending nothing and the platform recording
      // nothing are the same statement.
      expect(sent.containsKey('aadhaarDocUrl'), isFalse);
      expect(sent.containsKey('voterIdDocUrl'), isFalse);
    });

    testWidgets('a refusal is shown in the platform words, not as success',
        (tester) async {
      serveIdentity(submitFailure: 'A valid 12-digit Aadhaar number is required.');
      await pumpJourney(tester);
      await fillValidForm(tester);

      await tapSubmit(tester);

      expect(stubSaw('POST', '/identity/submit'), isTrue);
      expect(find.text('A valid 12-digit Aadhaar number is required.'),
          findsOneWidget);
      // Still on the form: the status screen would have nothing to read.
      expect(find.text('Verification Status'), findsNothing);
    });

    testWidgets('only an accepted submission moves to the status screen',
        (tester) async {
      await pumpJourney(tester);
      await fillValidForm(tester);

      await tapSubmit(tester);

      expect(stubSaw('POST', '/identity/submit'), isTrue);
      expect(find.text('Verification Status'), findsOneWidget);
      // The status is read back, not carried over from the form.
      expect(stubSaw('GET', '/identity/status/$_userId'), isTrue);
    });
  });

  group('the status NABIN answers', () {
    testWidgets('renders the row the platform returned', (tester) async {
      serveIdentity(application: _appRow());
      await pumpJourney(tester, initial: '/identity-verification-status');

      expect(stubSaw('GET', '/identity/status/$_userId'), isTrue);
      expect(find.text('Verification Pending'), findsOneWidget);
      expect(find.text(_sessionName), findsOneWidget);
      // These masks can only have come off the wire.
      expect(find.text(_serverMask), findsOneWidget);
      expect(find.text(_serverVoterMask), findsOneWidget);
      // Both document rows say what the platform holds: nothing. There is no upload path, so
      // there is no 'Submitted'/'Under review' document state left for a row to reach.
      expect(find.text('No document on file'), findsNWidgets(2));
      expect(find.text('Aadhaar'), findsOneWidget);
      expect(find.text('Voter ID'), findsOneWidget);
      expect(find.textContaining('/2026'), findsWidgets);
    });

    testWidgets('offers no button that can approve itself', (tester) async {
      serveIdentity(application: _appRow());
      await pumpJourney(tester, initial: '/identity-verification-status');

      expect(find.text('Simulator Controls (QA Testing)'), findsNothing);
      expect(find.text('Simulate Approve'), findsNothing);
      expect(find.text('Simulate Resubmit'), findsNothing);
      expect(find.text('Check again'), findsOneWidget);

      expect(stubSeen.where((s) => s.startsWith('PATCH ')), isEmpty);
      expect(stubSeen.where((s) => s.startsWith('PUT ')), isEmpty);
      expect(stubSeen.where((s) => s.startsWith('POST ')), isEmpty);
      final getsBefore =
          stubSeen.where((s) => s.startsWith('GET ')).length;

      // 'Check again' is the only affordance while a review is open, and re-reading
      // is all it can do.
      await tester.tap(find.text('Check again'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      final getsAfter =
          stubSeen.where((s) => s.startsWith('GET ')).length;
      expect(getsAfter, greaterThan(getsBefore));
      expect(stubSeen.where((s) => s.startsWith('POST ')), isEmpty);
    });

    testWidgets('a verified account is NABIN saying so', (tester) async {
      serveIdentity(
        application: _appRow(status: 'VERIFIED'),
        identityStatus: 'VERIFIED',
      );
      await pumpJourney(tester, initial: '/identity-verification-status');

      expect(find.text('Identity Verified!'), findsOneWidget);
      await tapRouteChange(tester, 'Proceed to Super-App');
      expect(find.text('SUPER_APP_HOME'), findsOneWidget);
    });

    testWidgets('a resubmission request carries the officer reason',
        (tester) async {
      serveIdentity(
        application: _appRow(
          status: 'RESUBMISSION_REQUIRED',
          resubmissionReason: 'The voter ID number did not match the card.',
        ),
        identityStatus: 'RESUBMISSION_REQUIRED',
      );
      await pumpJourney(tester, initial: '/identity-verification-status');

      expect(find.text('Resubmission Requested'), findsOneWidget);
      expect(
          find.text('The voter ID number did not match the card.'), findsOneWidget);
      expect(find.text('Identity Verified!'), findsNothing);
    });

    testWidgets('an account with no application is told so, and sent to the form',
        (tester) async {
      serveIdentity(application: null);
      await pumpJourney(tester, initial: '/identity-verification-status');

      expect(find.text('Not submitted yet'), findsOneWidget);
      expect(find.text('No identity application is on file for this account yet.'),
          findsOneWidget);
      // Nothing the old screen claimed about a pending review.
      expect(find.text('Verification Pending'), findsNothing);
      expect(find.text('Check again'), findsNothing);

      await tapRouteChange(tester, 'Start identity verification');
      expect(find.text('1. Personal Details'), findsOneWidget);
    });

    testWidgets('a refusal is reported, not rounded into a status',
        (tester) async {
      serveIdentity(readFailure: 'Access denied: cannot view another user identity status.');
      await pumpJourney(tester, initial: '/identity-verification-status');

      expect(find.text('Access denied: cannot view another user identity status.'),
          findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Verification Pending'), findsNothing);
    });

    testWidgets('no session means no id to ask for, and no guess',
        (tester) async {
      SessionManager.instance.clearSession();
      serveIdentity(application: _appRow());
      await pumpJourney(tester, initial: '/identity-verification-status');

      expect(stubSeen, isEmpty);
      expect(find.text('NABIN could not read your verification status.'),
          findsOneWidget);
      expect(find.text(_serverMask), findsNothing);
    });
  });
}
