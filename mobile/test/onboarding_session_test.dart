import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/auth/presentation/screens/otp_verification_screen.dart';
import 'package:mobile/features/auth/presentation/screens/personalization_screen.dart';
import 'package:mobile/features/auth/presentation/screens/phone_entry_screen.dart';

import 'support/http_stub.dart';

// Three screens in the sign-in chain ran on invented state.
//
// `PhoneEntryScreen` pushed on to the code screen even when NABIN refused to send
// a code, and pushed on unconditionally when the transport threw — so the
// customer was asked to type a code that had never been dispatched, into a form
// that then "verified" it.
//
// `OtpVerificationScreen` accepted a verified code and then, if the response
// happened to omit either field, minted its own credential —
// `'usr_session_${DateTime.now().millisecondsSinceEpoch}'` — and its own user —
// `{'id': 'usr_cust_$phone'}` — and called that a session. Every later call that
// authenticates (`/auth/me`, the wallet, the bookings, the identity application)
// would have been refused by NABIN with that token, and the id those rows are
// keyed by was a string the device made up.
//
// `PersonalizationScreen` opened already filled in with 'Rahul Sharma' and
// 'rahul.sharma@example.com', both editable, with a camera badge that answered
// 'Avatar updated' to a tap that chose no picture, and a language selector whose
// four chips only changed their own colour — the app carries no localization
// delegates, so Mizo, Hindi and Bengali were never reachable. 'Get Moving' spun
// for 600 ms and navigated on having written nothing.
//
// The bar here is the wire and the session: a credential exists only because the
// platform handed it over, the name shown is the name the platform's user row
// carries, and no control offers an action the app cannot perform.

const String _phone = '9876543210';
const String _serverToken = 'nabin_CUSTOMER_tok_serverissued';
const String _serverUserId = 'usr_20261004_zoram';
const String _serverName = 'Zoramthanga Sailo';
const String _serverEmail = 'zoram.sailo@example.test';

String? _verifyFailure;
String? _sendFailure;
String? _issuedToken;
Map<String, dynamic>? _issuedUser;
Map<String, dynamic>? _lastVerifyBody;

/// Fakes `POST /api/auth/verify-otp` and `/send-otp` in the shape the backend
/// actually answers with: `{success, message, token, role, user}`
/// (`db.verifyAuthOtp`), or `{success: false, error}` when it refuses.
///
/// [token]/[user] can be withheld on purpose — that is the case the screen used
/// to paper over with its own invented values.
void serveAuth({
  bool omitToken = false,
  bool omitUser = false,
  bool userWithoutId = false,
  String? verifyFailure,
  String? sendFailure,
}) {
  stubReset();
  _verifyFailure = verifyFailure;
  _sendFailure = sendFailure;
  _issuedToken = omitToken ? null : _serverToken;
  _issuedUser = omitUser
      ? null
      : userWithoutId
          ? <String, dynamic>{'name': _serverName, 'phone': '+91$_phone'}
          : <String, dynamic>{
              'id': _serverUserId,
              'name': _serverName,
              'email': _serverEmail,
              'phone': '+91$_phone',
              'role': 'CUSTOMER',
            };
  _lastVerifyBody = null;

  stubHandler = (method, url, body) {
    if (method == 'POST' && url.path.endsWith('/auth/verify-otp')) {
      _lastVerifyBody =
          body.isEmpty ? <String, dynamic>{} : jsonDecode(body) as Map<String, dynamic>;
      if (_verifyFailure != null) {
        return (400, jsonEncode(<String, dynamic>{
          'success': false,
          'error': _verifyFailure,
        }));
      }
      final payload = <String, dynamic>{
        'success': true,
        'message': 'Authentication successful.',
        'role': 'CUSTOMER',
      };
      if (_issuedToken != null) payload['token'] = _issuedToken;
      if (_issuedUser != null) payload['user'] = _issuedUser;
      return (200, jsonEncode(payload));
    }
    if (method == 'POST' && url.path.endsWith('/auth/send-otp')) {
      if (_sendFailure != null) {
        return (429, jsonEncode(<String, dynamic>{
          'success': false,
          'error': _sendFailure,
        }));
      }
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'message': 'OTP dispatched.',
      }));
    }
    return (404, '{"success":false,"error":"no route"}');
  };
}

Future<void> pumpAuthJourney(
  WidgetTester tester, {
  String initial = '/otp-verification',
}) async {
  // Same reason as in `identity_verification_test.dart`: on the default 800x600
  // surface the button below the fold warns on tap and does nothing, which a test
  // then reads as a passing assertion about a request that was never made.
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final router = GoRouter(
    initialLocation: initial,
    routes: <RouteBase>[
      GoRoute(
        path: '/phone-entry',
        builder: (context, state) => const PhoneEntryScreen(),
      ),
      GoRoute(
        path: '/otp-verification',
        builder: (context, state) => const OtpVerificationScreen(phoneNumber: _phone),
      ),
      GoRoute(
        path: '/personalization',
        builder: (context, state) => const PersonalizationScreen(),
      ),
      GoRoute(
        path: '/identity-verification-submit',
        builder: (context, state) => const Scaffold(body: Text('IDENTITY_SUBMIT')),
      ),
    ],
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  await tester.pump();
}

/// Types the four digits into the four boxes, then verifies. The spinner in
/// `NabinButton` is animated, so this pumps fixed frames rather than settling.
Future<void> typeAndVerify(WidgetTester tester, {String otp = '4821'}) async {
  for (int i = 0; i < otp.length; i++) {
    await tester.enterText(find.byType(TextField).at(i), otp[i]);
    await tester.pump();
  }
  await tester.tap(find.text('Verify & Proceed'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    SessionManager.instance.clearSession();
    serveAuth();
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('a verified code becomes the session NABIN issued', () {
    testWidgets('stores the token and user id the server returned', (tester) async {
      await pumpAuthJourney(tester);
      await typeAndVerify(tester);

      expect(stubSaw('POST', '/auth/verify-otp'), isTrue);
      expect(SessionManager.instance.isAuthenticated, isTrue);
      expect(SessionManager.instance.token, _serverToken);
      expect(NabinApiService.authToken, _serverToken);

      final user = SessionManager.instance.currentUser!;
      expect(user['id'], _serverUserId);
      expect(user['name'], _serverName);

      // The invented fallbacks this screen used to write when a response was
      // incomplete must not appear even when the response is complete.
      final serialised = jsonEncode(user);
      expect(serialised.contains('usr_cust_'), isFalse);
      expect(SessionManager.instance.token!.startsWith('usr_session_'), isFalse);
    });

    testWidgets('sends only the four fields the route takes', (tester) async {
      await pumpAuthJourney(tester);
      await typeAndVerify(tester, otp: '4821');

      expect(_lastVerifyBody, isNotNull);
      expect(_lastVerifyBody!['phone'], _phone);
      expect(_lastVerifyBody!['otp'], '4821');
      expect(_lastVerifyBody!['role'], 'CUSTOMER');
      expect(_lastVerifyBody!['purpose'], 'LOGIN');
      // No name, no avatar, no preferred language: nothing this screen collected
      // on its own and passed off as the customer's profile.
      expect(_lastVerifyBody!.keys.toSet(),
          <String>{'phone', 'otp', 'role', 'purpose'});
    });

    testWidgets('the next step shows the account the server named', (tester) async {
      await pumpAuthJourney(tester);
      await typeAndVerify(tester);

      expect(find.text('Complete your profile'), findsOneWidget);
      expect(find.text(_serverName), findsOneWidget);
      expect(find.text(_serverEmail), findsOneWidget);
      expect(find.text('Rahul Sharma'), findsNothing);
    });

    testWidgets('a success with no token issues no session', (tester) async {
      serveAuth(omitToken: true);
      await pumpAuthJourney(tester);
      await typeAndVerify(tester);

      expect(SessionManager.instance.isAuthenticated, isFalse);
      expect(SessionManager.instance.token, isNull);
      expect(NabinApiService.authToken, isNull);
      expect(
        find.textContaining('did not hand this device a session'),
        findsOneWidget,
      );
      // And it does not walk on to the step that would have used the fake one.
      expect(find.text('Complete your profile'), findsNothing);
    });

    testWidgets('a user row with no id is refused too', (tester) async {
      serveAuth(userWithoutId: true);
      await pumpAuthJourney(tester);
      await typeAndVerify(tester);

      expect(SessionManager.instance.isAuthenticated, isFalse);
      expect(find.text('Complete your profile'), findsNothing);
      expect(
        find.textContaining('did not hand this device a session'),
        findsOneWidget,
      );
    });

    testWidgets('a refused code leaves no session and says what the platform said',
        (tester) async {
      serveAuth(verifyFailure: 'That code has expired. Ask for a new one.');
      await pumpAuthJourney(tester);
      await typeAndVerify(tester);

      expect(SessionManager.instance.isAuthenticated, isFalse);
      expect(find.textContaining('That code has expired'), findsOneWidget);
      expect(find.text('Complete your profile'), findsNothing);
    });

    testWidgets('resend asks the platform for a new code', (tester) async {
      await pumpAuthJourney(tester);
      final before = stubSeen.length;

      await tester.tap(find.text('Resend code'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(stubSeen.length, greaterThan(before));
      expect(stubSaw('POST', '/auth/send-otp'), isTrue);
      expect(find.textContaining('A new verification code is on its way'), findsOneWidget);
    });
  });

  group('the personalization step does only what it can', () {
    Future<void> signIn(
      WidgetTester tester,
      Map<String, dynamic> user,
    ) async {
      SessionManager.instance.saveSession(token: _serverToken, user: user);
      await pumpAuthJourney(tester, initial: '/personalization');
    }

    testWidgets('the account details are records, not inputs', (tester) async {
      await signIn(tester, <String, dynamic>{
        'id': _serverUserId,
        'name': _serverName,
        'email': _serverEmail,
      });

      expect(find.text(_serverName), findsOneWidget);
      expect(find.text(_serverEmail), findsOneWidget);
      // This step is the identity declaration, so it carries no inputs — the editable
      // home for name and email is the profile screen, and the copy says so.
      expect(find.byType(TextField), findsNothing);
      expect(find.textContaining('use Profile → Edit'), findsOneWidget);
      expect(find.textContaining('no way to'), findsNothing);
    });

    testWidgets('the monogram is the account\'s own initials', (tester) async {
      await signIn(tester, <String, dynamic>{'id': _serverUserId, 'name': _serverName});

      expect(find.text('ZS'), findsOneWidget);
      expect(find.text('RS'), findsNothing);
    });

    testWidgets('an account with no name says so instead of borrowing one',
        (tester) async {
      await signIn(tester, <String, dynamic>{'id': _serverUserId, 'phone': '+91$_phone'});

      expect(find.text('Rahul Sharma'), findsNothing);
      expect(find.text('rahul.sharma@example.com'), findsNothing);
      expect(find.text('Not on your NABIN account'), findsNWidgets(2));
      expect(find.text('ZS'), findsNothing);
    });

    testWidgets('no avatar control that picks nothing', (tester) async {
      await signIn(tester, <String, dynamic>{'id': _serverUserId, 'name': _serverName});

      expect(find.text('Avatar updated'), findsNothing);
      expect(find.byIcon(Icons.camera_alt_rounded), findsNothing);
    });

    testWidgets('only the language the app actually speaks is offered',
        (tester) async {
      await signIn(tester, <String, dynamic>{'id': _serverUserId, 'name': _serverName});

      expect(find.text('English'), findsOneWidget);
      // The app has no localization delegates, so these chips could only ever
      // change their own colour.
      expect(find.textContaining('Mizo'), findsOneWidget);
      expect(find.text('मिज़ो (Mizo)'), findsNothing);
      expect(find.text('हिंदी (Hindi)'), findsNothing);
      expect(find.text('বাংলা (Bengali)'), findsNothing);
    });

    testWidgets('Get Moving continues and writes nothing', (tester) async {
      await signIn(tester, <String, dynamic>{'id': _serverUserId, 'name': _serverName});

      await tester.tap(find.text('Get Moving'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('IDENTITY_SUBMIT'), findsOneWidget);
      expect(stubSeen, isEmpty);
    });
  });

  group('the code screen opens only when NABIN says it sent one', () {
    testWidgets('a refusal keeps the customer on the number they typed',
        (tester) async {
      serveAuth(
          sendFailure: 'Too many codes requested for this number. Try again later.');
      await pumpAuthJourney(tester, initial: '/phone-entry');

      await tester.tap(find.text('Continue'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(stubSaw('POST', '/auth/send-otp'), isTrue);
      expect(find.textContaining('Too many codes requested'), findsOneWidget);
      // It used to push on anyway "with warning", which put the customer in front of a
      // code-entry form for a code that was never dispatched.
      expect(find.text("Verify it's you"), findsNothing);
    });

    testWidgets('an accepted request moves on to the code', (tester) async {
      await pumpAuthJourney(tester, initial: '/phone-entry');

      await tester.tap(find.text('Continue'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(stubSaw('POST', '/auth/send-otp'), isTrue);
      expect(find.text("Verify it's you"), findsOneWidget);
    });
  });
}
