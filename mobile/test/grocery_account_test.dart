import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_account_screen.dart';

import 'support/http_stub.dart';

// The Grocery shell's Account tab — reached twice from Customer Home through
// `/grocery-home` — was one of the most heavily invented surfaces in the app. It
// opened on 'Rahul Sharma' with a verified badge and
// '+91 98765 43210 • rahul.sharma@example.com', showed an 'M3 GROCERY WALLET'
// holding ₹450.00 whose '+ Add Cash' button replied 'Added ₹500 to Grocery
// Wallet!' to a tap that moved nothing, listed two orders ('M3-882910' delivered
// in 8 minutes, 'M3-881942' in 9) that exist in no store, offered 'Saved
// Delivery Addresses — Civil Lines, Connaught Place' (Delhi, and a `() {}`
// handler), 'Saved Payment Methods — UPI, HDFC Visa Card **** 8888', a support
// sheet promising a 24/7 express team, and 'Version 2.4.0 • Standalone Quick
// Commerce App'.
//
// These tests hold the tab to `GET /api/auth/me`: the name shown is the one the
// account's own row carries, the balance is the number the platform answered
// with, a refusal is rendered as a refusal, and no control remains that has no
// route behind it.

const String _serverName = 'Zoramthanga Sailo';
const String _serverPhone = '+919436120145';

/// Not the screen's own number: `toStringAsFixed(2)` of the value the fake answers
/// with, so a hard-coded ₹450.00 cannot pass for it.
const double _serverBalance = 318.4;

Map<String, dynamic>? _profileUser;
String? _profileFailure;

void serveProfile({
  Map<String, dynamic>? user,
  String? failure,
}) {
  stubReset();
  _profileUser = user ??
      <String, dynamic>{
        'id': 'usr_grocery_1',
        'name': _serverName,
        'phone': _serverPhone,
        'walletBalance': _serverBalance,
      };
  _profileFailure = failure;

  stubHandler = (method, url, body) {
    if (method == 'GET' && url.path.endsWith('/auth/me')) {
      if (_profileFailure != null) {
        return (401, jsonEncode(<String, dynamic>{
          'success': false,
          'error': _profileFailure,
        }));
      }
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'role': 'CUSTOMER',
        'user': _profileUser,
      }));
    }
    return (404, '{"success":false,"error":"no route"}');
  };
}

/// Flips the fake back to answering successfully without touching the request log,
/// so a retry test can count its own second read instead of losing the first.
void acceptProfile() => _profileFailure = null;

Future<void> pumpAccount(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(800, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final router = GoRouter(
    initialLocation: '/grocery-account',
    routes: <RouteBase>[
      GoRoute(
        path: '/grocery-account',
        builder: (context, state) => const GroceryAccountScreen(),
      ),
      GoRoute(
        path: '/wallet',
        builder: (context, state) => const Scaffold(body: Text('WALLET_SCREEN')),
      ),
      GoRoute(
        path: '/activity',
        builder: (context, state) => const Scaffold(body: Text('ACTIVITY_SCREEN')),
      ),
      GoRoute(
        path: '/support',
        builder: (context, state) => const Scaffold(body: Text('SUPPORT_SCREEN')),
      ),
    ],
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  // The screen reads on open; two frames clears the request and the rebuild.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

Future<void> tapRoute(WidgetTester tester, String label) async {
  await tester.tap(find.text(label));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    SessionManager.instance.saveSession(
      token: 'stub-session-token',
      user: <String, dynamic>{'id': 'usr_grocery_1', 'name': _serverName},
    );
    serveProfile();
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('the account tab reads the account', () {
    testWidgets('it asks NABIN rather than painting a sample person', (tester) async {
      await pumpAccount(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.text(_serverName), findsOneWidget);
      expect(find.text(_serverPhone), findsOneWidget);
    });

    testWidgets('the balance is the number the platform answered with',
        (tester) async {
      await pumpAccount(tester);

      expect(find.textContaining('₹${_serverBalance.toStringAsFixed(2)}'), findsOneWidget);
      // The literal this tab used to open on.
      expect(find.text('₹450.00'), findsNothing);
    });

    testWidgets('none of the invented account furniture survives', (tester) async {
      await pumpAccount(tester);

      for (final invented in <String>[
        'Rahul Sharma',
        'rahul.sharma@example.com',
        '98765 43210',
        'M3',
        'Delivered in 8 mins',
        'M3-882910',
        'Civil Lines, Connaught Place',
        'Saved Payment Methods',
        'Saved Delivery Addresses',
        'HDFC Visa Card',
        'Version 2.4.0',
        '+ Add Cash',
        '24/7',
        '10-Minute',
      ]) {
        expect(find.textContaining(invented), findsNothing, reason: invented);
      }
    });

    testWidgets('what NABIN cannot serve is stated, not drawn as a tile',
        (tester) async {
      await pumpAccount(tester);

      expect(find.textContaining('does not keep a saved-address book'), findsOneWidget);
      expect(find.textContaining('the address you type at checkout'), findsOneWidget);
    });

    testWidgets('support goes to the screen that files a real ticket',
        (tester) async {
      await pumpAccount(tester);

      await tapRoute(tester, 'Get help with an order');
      expect(find.text('SUPPORT_SCREEN'), findsOneWidget);
    });

    testWidgets('orders goes to the screen that reads them back', (tester) async {
      await pumpAccount(tester);

      await tapRoute(tester, 'Your NABIN orders');
      expect(find.text('ACTIVITY_SCREEN'), findsOneWidget);
    });

    testWidgets('the wallet card opens the wallet', (tester) async {
      await pumpAccount(tester);

      await tapRoute(tester, 'NABIN WALLET');
      expect(find.text('WALLET_SCREEN'), findsOneWidget);
    });
  });

  group('when NABIN refuses', () {
    testWidgets('the tab refuses too instead of borrowing an identity',
        (tester) async {
      serveProfile(failure: 'Invalid or expired session token.');

      await pumpAccount(tester);

      expect(find.text('NABIN did not answer'), findsOneWidget);
      expect(find.textContaining('Invalid or expired session token'), findsOneWidget);
      expect(find.text(_serverName), findsNothing);
      expect(find.text('₹450.00'), findsNothing);
      expect(find.text('Rahul Sharma'), findsNothing);
      expect(find.textContaining('Try again'), findsOneWidget);
    });

    testWidgets('retry re-reads and then shows the real row', (tester) async {
      serveProfile(failure: 'Invalid or expired session token.');
      await pumpAccount(tester);
      final readsBefore =
          stubSeen.where((s) => s.startsWith('GET ')).length;

      acceptProfile();
      await tapRoute(tester, 'Try again');

      expect(find.text(_serverName), findsOneWidget);
      expect(
        stubSeen.where((s) => s.startsWith('GET ')).length,
        greaterThan(readsBefore),
      );
    });

    testWidgets('a wallet balance the row does not carry is not guessed',
        (tester) async {
      serveProfile(user: <String, dynamic>{
        'id': 'usr_grocery_1',
        'name': _serverName,
        'phone': _serverPhone,
      });

      await pumpAccount(tester);

      expect(find.text('Not readable'), findsOneWidget);
      expect(find.textContaining('₹'), findsNothing);
    });
  });
}
