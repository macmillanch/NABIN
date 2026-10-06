import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/profile/presentation/screens/profile_screen.dart';

import 'support/http_stub.dart';

// The Profile screen was a StatelessWidget that hardcoded the person it belonged to:
// 'Rahul Sharma', '+91 98765 43210', 'rahul.sharma@example.com', the initials 'RS', a
// '42 Rides Taken / 18 Food Orders / ⭐ 4.98 User Rating' stat row, and a "Saved Payment
// Cards" tile whose modal asserted 'Primary: HDFC Visa Card **** 8888 / UPI Autopay:
// rahul@okhdfcbank / Status: Verified & Active'. It made no request at all.
//
// Two reads cover what it can honestly show: GET /auth/me for the identity (and the
// rating the server carries) and GET /customer/activity for the counts. No route returns
// a payment instrument, so that tile has nothing to be honest about and goes.
//
// As elsewhere: assert the request left before asserting content, because an error state
// also satisfies "the invented literal is gone".

void serve({
  Map<String, dynamic>? user = const <String, dynamic>{
    'id': 'usr_real_42',
    'name': 'Lalthanmawli Vanminuwa',
    'phone': '+91 94360 11223',
    'email': 'lalthan@example.in',
    'rating': 4.7,
  },
  bool profileOk = true,
  List<Map<String, dynamic>> activity = const <Map<String, dynamic>>[],
  bool activityOk = true,
  bool preferencesOk = true,
  bool preferencesPutOk = true,
}) {
  // The row the store holds, so a read after a write returns what was written rather
  // than a fixture that forgot the write.
  final Map<String, bool> stored = <String, bool>{
    for (final key in <String>[
      'ridesEnabled', 'driverUpdatesEnabled', 'parcelEnabled', 'foodEnabled',
      'groceryEnabled', 'paymentsEnabled', 'promotionsEnabled', 'supportEnabled',
      'systemEnabled', 'pushEnabled', 'inAppEnabled', 'smsEnabled', 'emailEnabled',
    ])
      key: true,
  };

  stubHandler = (method, url, body) {
    final String path = url.path;
    if (path.contains('/auth/me')) {
      if (!profileOk) {
        return (500, jsonEncode({'success': false, 'error': 'store unavailable'}));
      }
      return (
        200,
        jsonEncode(<String, dynamic>{
          'success': true,
          'role': 'CUSTOMER',
          'user': user,
          'token': 'test-token',
        })
      );
    }
    if (path.contains('/customer/activity')) {
      if (!activityOk) {
        return (500, jsonEncode({'success': false, 'error': 'store unavailable'}));
      }
      return (
        200,
        jsonEncode(<String, dynamic>{'success': true, 'items': activity})
      );
    }
    if (path.contains('/notifications/preferences')) {
      if (method == 'PUT') {
        if (!preferencesPutOk) {
          return (500, jsonEncode({'success': false, 'error': 'store unavailable'}));
        }
        (jsonDecode(body) as Map<String, dynamic>).forEach((k, v) => stored[k] = v as bool);
        return (
          200,
          jsonEncode(<String, dynamic>{'success': true, 'preferences': stored})
        );
      }
      if (!preferencesOk) {
        return (500, jsonEncode({'success': false, 'error': 'store unavailable'}));
      }
      return (
        200,
        jsonEncode(<String, dynamic>{'success': true, 'preferences': stored})
      );
    }
    return (200, '{"success":true}');
  };
}

Map<String, dynamic> _job(String service, {String status = 'COMPLETED'}) {
  return <String, dynamic>{
    'id': 'ord_${service}_$status',
    'service': service,
    'title': 'A real job',
    'status': status,
    'amount': 120,
    'placedAt': '2026-10-01T09:00:00.000Z',
    'active': false,
  };
}

Future<void> pumpProfile(WidgetTester tester) async {
  await tester.pumpWidget(const MaterialApp(home: ProfileScreen()));
  // No pumpAndSettle: the reads paint a spinner while they are in flight.
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    // A baseline the honest path serves, so a test only says what differs from it.
    serve();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_real_42', 'name': 'Lalthanmawli Vanminuwa'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('identity', () {
    testWidgets('renders who the profile read says the customer is', (tester) async {
      serve();

      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.text('Lalthanmawli Vanminuwa'), findsWidgets);
      expect(find.text('+91 94360 11223'), findsWidgets);
      expect(find.text('lalthan@example.in'), findsWidgets);
    });

    testWidgets('derives the avatar initials from the real name', (tester) async {
      serve();

      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.text('LV'), findsWidgets);
    });

    testWidgets('never paints the demo customer', (tester) async {
      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      for (final String claim in <String>[
        'Rahul Sharma',
        '+91 98765 43210',
        'rahul.sharma@example.com',
        'RS',
      ]) {
        expect(find.text(claim), findsNothing, reason: '$claim was a const literal');
      }
    });

    testWidgets('a refused read asks for a retry instead of guessing', (tester) async {
      serve(profileOk: false);

      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.textContaining("Couldn't load your profile"), findsWidgets);
      expect(find.textContaining('Retry'), findsWidgets);
      expect(find.text('Rahul Sharma'), findsNothing);
    });
  });

  group('stats', () {
    testWidgets('counts this customer\'s own jobs and orders', (tester) async {
      serve(activity: <Map<String, dynamic>>[
        _job('RIDE'),
        _job('RIDE', status: 'CANCELLED'),
        _job('FOOD'),
        _job('PARCEL'),
      ]);

      await pumpProfile(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      expect(find.text('2'), findsWidgets);
      expect(find.text('1'), findsWidgets);
    });

    // #140. The stub deliberately keeps serving `'rating': 4.7` — a stale or differently
    // scoped server may still put the column on the wire, and the screen must not turn it
    // into a score about the customer. `users.rating NUMERIC(3,2) DEFAULT 5.00`
    // (001_central_schema.sql:22) with no reviews or ratings table in this schema is a
    // column default, not a measurement: the same ruling migration 034 made for
    // `merchants.rating` and #138 made for `drivers.rating`. So this asserts the absence
    // both of the number and of the slot that used to hold it.
    testWidgets('paints no user rating, even when the response still carries the column',
        (tester) async {
      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.textContaining('4.70'), findsNothing);
      expect(find.textContaining('⭐'), findsNothing);
      expect(find.text('User Rating'), findsNothing);
    });

    testWidgets('never paints the invented 42 / 18 / 4.98', (tester) async {
      serve(activity: <Map<String, dynamic>>[]);

      await pumpProfile(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      for (final String claim in <String>['42', '18', '4.98']) {
        expect(find.textContaining(claim), findsNothing, reason: '$claim was a const literal');
      }
    });

    testWidgets('a refused activity read shows no counts', (tester) async {
      serve(activityOk: false);

      await pumpProfile(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      // A row of dashes admits the gap; a row of zeros reports it as a fact.
      expect(find.text('0'), findsNothing);
    });

    testWidgets('a profile with no rating column paints no star', (tester) async {
      serve(user: <String, dynamic>{
        'id': 'usr_real_42',
        'name': 'Lalthanmawli Vanminuwa',
        'phone': '+91 94360 11223',
      });

      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.textContaining('⭐'), findsNothing);
    });
  });

  group('payment instruments', () {
    testWidgets('claims no saved card, UPI id or verification status', (tester) async {
      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      for (final String claim in <String>[
        'Saved Payment Cards',
        '8888',
        'rahul@okhdfcbank',
        'UPI Autopay',
        'Verified & Active',
      ]) {
        expect(find.textContaining(claim), findsNothing,
            reason: '$claim named an instrument no endpoint returns');
      }
    });
  });

  group('saved addresses', () {
    testWidgets('the tile admits there is nothing to list instead of naming places',
        (tester) async {
      await pumpProfile(tester);
      await tester.ensureVisible(find.text('Saved Addresses'));
      await tester.tap(find.text('Saved Addresses'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.textContaining('does not keep saved addresses'), findsOneWidget);
      for (final String claim in <String>[
        'Home (Kamla Nagar), Work (CP)',
        'Flat 402, Kamla Nagar',
        'Connaught Place',
      ]) {
        expect(find.textContaining(claim), findsNothing,
            reason: '$claim named an address no endpoint reads or writes');
      }
    });
  });

  group('notification preferences', () {
    /// Opens the sheet and lets the preferences read land. No pumpAndSettle: the sheet
    /// paints a spinner while the read is in flight.
    Future<void> openSheet(WidgetTester tester) async {
      await tester.ensureVisible(find.text('Push Notification Preferences'));
      await tester.tap(find.text('Push Notification Preferences'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }
    }

    testWidgets('asks the backend what it may tell this customer about',
        (tester) async {
      await pumpProfile(tester);
      await openSheet(tester);

      expect(stubSaw('GET', '/notifications/preferences'), isTrue);
      expect(find.byType(Switch), findsNWidgets(13));
      expect(find.text('Rides'), findsOneWidget);
      expect(find.text('Push notifications'), findsOneWidget);
      expect(find.text('Email'), findsOneWidget);
    });

    testWidgets('never paints the three states it used to assert', (tester) async {
      await pumpProfile(tester);
      await openSheet(tester);

      expect(stubSaw('GET', '/notifications/preferences'), isTrue);
      for (final String claim in <String>[
        'Real-time Ride Telemetry',
        'School Arrival & Drop-off SMS',
        'Dual-OTP Verification SMS',
      ]) {
        expect(find.textContaining(claim), findsNothing,
            reason: '$claim was a const literal about a channel no read confirms');
      }
    });

    testWidgets('a toggle PUTs the one key it changed and keeps the row the store returns',
        (tester) async {
      await pumpProfile(tester);
      await openSheet(tester);

      final rides = find.byKey(const ValueKey('notification-pref-ridesEnabled'));
      expect(tester.widget<Switch>(rides).value, isTrue);

      await tester.tap(rides);
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }

      expect(stubSaw('PUT', '/notifications/preferences'), isTrue);
      expect(
        jsonDecode(stubBodyFor('PUT', '/notifications/preferences')!),
        <String, dynamic>{'ridesEnabled': false},
      );
      expect(tester.widget<Switch>(rides).value, isFalse);
    });

    testWidgets('a refused write puts the toggle back and says the change was not saved',
        (tester) async {
      serve(preferencesPutOk: false);
      await pumpProfile(tester);
      await openSheet(tester);

      final rides = find.byKey(const ValueKey('notification-pref-ridesEnabled'));
      await tester.tap(rides);
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }

      expect(stubSaw('PUT', '/notifications/preferences'), isTrue);
      expect(tester.widget<Switch>(rides).value, isTrue);
      expect(find.textContaining('That change was not saved'), findsOneWidget);
    });

    testWidgets('a refused read asks for a retry instead of assuming every subject is on',
        (tester) async {
      serve(preferencesOk: false);
      await pumpProfile(tester);
      await openSheet(tester);

      expect(stubSaw('GET', '/notifications/preferences'), isTrue);
      expect(find.byType(Switch), findsNothing);
      expect(find.textContaining("couldn't load your notification preferences"),
          findsOneWidget);
      expect(find.text('Retry'), findsWidgets);
    });
  });

  group('phone layout', () {
    testWidgets('a long real name survives 390 px without a paint failure',
        (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      serve(user: <String, dynamic>{
        'id': 'usr_real_42',
        'name': 'Lalthanmawli Vanminuwa',
        'phone': '+91 94360 11223',
        'email': 'lalthanmawli.vanminuwa@example.in',
        'rating': 4.7,
      });

      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(tester.takeException(), isNull);
    });
  });
}
