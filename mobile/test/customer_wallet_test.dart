import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/wallet/presentation/screens/wallet_screen.dart';

import 'customer_home_config_test.dart' as home;
import 'support/http_stub.dart';

// The wallet screen shipped as an illustration: a `double _balance = 450.00`, two
// payment instruments nobody had saved ("HDFC Bank Debit Card (Visa **** 8888)",
// "rahul@okhdfcbank"), three ledger rows with reference ids ("TXN-998812",
// "Food Delivery (Dilli Darbar)"), and a Top Up sheet that added money to the local
// variable and reported "added successfully" to the customer. None of it is backed by
// a route: the backend has no customer wallet endpoint, and the only payment routes
// are order-scoped (POST /payments/create-order, /verify-checkout).
//
// What the app *can* read is the profile: GET /auth/me returns `user: session.entity`
// and that entity carries camelCase `walletBalance`, in both the in-memory mirror
// (`database.js`) and the Postgres projection. So this screen now reads that one
// number and says plainly what it cannot do.
//
// Every balance test asserts the request left before asserting on content — an error
// state also satisfies "the invented ₹450 is gone", so without the saw-check a dead
// transport would pass for a wired-up screen.

/// Answers GET /auth/me the way the backend does: `{success, role, user, token}`.
/// `walletBalance: null` models an entity that simply has no such column.
void serveProfile(Object? walletBalance) {
  stubHandler = (method, url, _) {
    if (!url.path.contains('/auth/me')) return (200, '{"success":true}');
    return (
      200,
      jsonEncode(<String, dynamic>{
        'success': true,
        'role': 'CUSTOMER',
        'user': <String, dynamic>{
          'id': 'usr_real_42',
          'name': 'Test Customer',
          if (walletBalance != null) 'walletBalance': walletBalance,
        },
        'token': 'test-token',
      })
    );
  };
}

/// The store-unreachable shape: a status that is not an answer about the balance.
void serveRefused() {
  stubHandler = (method, url, _) => (
        500,
        jsonEncode({'success': false, 'error': 'store unavailable'}),
      );
}

Future<void> pumpWallet(WidgetTester tester) async {
  await tester.pumpWidget(const MaterialApp(home: WalletScreen()));
  // No pumpAndSettle: the screen paints a spinner while the read is in flight, and an
  // indefinite animation never settles.
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// Copy the fabricated surface used to paint. Substrings, because the full strings
/// differ only in how the widget splits them across lines.
const List<String> inventedInstruments = <String>[
  'HDFC',
  '8888',
  'rahul@okhdfcbank',
  'Autopay',
  'Saved Payment Methods',
];

const List<String> inventedLedger = <String>[
  'TXN-998812',
  'TXN-884719',
  'TXN-773821',
  'Dilli Darbar',
  'Civil Lines',
  'Recent Ledger Statements',
  'Transaction Receipt',
];

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_real_42', 'name': 'Test Customer'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('balance', () {
    testWidgets('reads the number the profile endpoint returns', (tester) async {
      serveProfile(260.5);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.textContaining('₹260.50'), findsWidgets);
    });

    testWidgets('a real zero is shown as zero', (tester) async {
      serveProfile(0);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.textContaining('₹0.00'), findsWidgets);
    });

    testWidgets('never paints the ₹450.00 the screen was written with', (tester) async {
      serveProfile(90);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.textContaining('₹90.00'), findsWidgets);
      expect(find.textContaining('450'), findsNothing);
    });

    testWidgets('a refused read offers Retry and shows no balance', (tester) async {
      serveRefused();

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.textContaining("Couldn't load your balance"), findsWidgets);
      expect(find.textContaining('Retry'), findsWidgets);
      expect(find.textContaining('₹'), findsNothing);
    });

    testWidgets('a profile with no balance column is not reported as zero', (tester) async {
      serveProfile(null);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      // "You have no money" and "we could not read your money" are different
      // sentences, and the second one is what a missing column means.
      expect(find.textContaining('₹0.00'), findsNothing);
      expect(find.textContaining("Couldn't load your balance"), findsWidgets);
    });
  });

  group('nothing invented', () {
    testWidgets('names no payment instrument the customer never saved', (tester) async {
      serveProfile(90);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      for (final String fragment in inventedInstruments) {
        expect(find.textContaining(fragment), findsNothing,
            reason: '$fragment described a card no endpoint returns');
      }
    });

    testWidgets('shows no ledger rows and no receipt for them', (tester) async {
      serveProfile(90);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      for (final String fragment in inventedLedger) {
        expect(find.textContaining(fragment), findsNothing,
            reason: '$fragment was a const literal');
      }
    });

    testWidgets('the top-up affordance admits it cannot add money', (tester) async {
      serveProfile(90);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      // The old sheet offered ₹100/250/500/1000 buttons that mutated the local double
      // and announced success. A customer who believed that banner would think money
      // had left their bank.
      expect(find.textContaining("isn't available yet"), findsWidgets);
      expect(find.textContaining('added successfully'), findsNothing);
      expect(find.textContaining('+ ₹250'), findsNothing);
    });
  });

  group('the wallet pill on Home', () {
    Future<void> pumpWithUser(WidgetTester tester, Map<String, dynamic> user) async {
      SessionManager.instance.clearSession();
      SessionManager.instance.saveSession(token: 'test-token', user: user);
      await home.pumpHome(
        tester,
        body: <String, dynamic>{
          'services': home.allServicesActive,
        },
      );
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
    }

    testWidgets('shows the session balance instead of ₹0', (tester) async {
      // The pill read user['wallet_balance'] while the session entity is camelCase,
      // so it printed ₹0 for every customer who actually had money.
      await pumpWithUser(tester, <String, dynamic>{
        'id': 'usr_real_42',
        'name': 'Test Customer',
        'walletBalance': 615.0,
      });

      expect(find.text('₹615'), findsWidgets);
      expect(find.text('₹0'), findsNothing);
    });

    testWidgets('shows no figure when the session never carried one', (tester) async {
      await pumpWithUser(tester, <String, dynamic>{
        'id': 'usr_real_42',
        'name': 'Test Customer',
      });

      expect(find.text('₹0'), findsNothing);
    });
  });

  group('phone layout', () {
    testWidgets('a wide rupee figure survives 390 px without a paint failure',
        (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      serveProfile(1298450.75);

      await pumpWallet(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(tester.takeException(), isNull);
    });
  });
}
