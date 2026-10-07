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
  int profilePatchStatus = 200,
  String profilePatchCode = 'EMAIL_ALREADY_USED',
  String profilePatchError =
      'That email address already belongs to a NABIN account, so it cannot be used here. '
      'Nothing was changed.',
  bool profilePatchAnswers = true,
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

  // The same trick on the profile side: the PATCH answer comes out of this map, so a test
  // that asserts "the screen shows what the server returned" cannot be satisfied by a
  // fixture that would echo whatever was asked for.
  final Map<String, dynamic> row = <String, dynamic>{...?user};

  stubHandler = (method, url, body) {
    final String path = url.path;
    if (path.contains('/customer/profile') && method == 'PATCH') {
      if (!profilePatchAnswers) {
        // No answer at all: the socket fails, so the service's own catch fires and the
        // screen has to say "couldn't reach" without claiming the change was stored.
        throw const SocketException('connection refused');
      }
      if (profilePatchStatus != 200) {
        return (
          profilePatchStatus,
          jsonEncode(<String, dynamic>{
            'success': false,
            'code': profilePatchCode,
            'error': profilePatchError,
          })
        );
      }
      final patch = jsonDecode(body) as Map<String, dynamic>;
      // The backend trims the name and trims and case-folds the email, so the stub does
      // too — otherwise the screen could look correct while showing text that was never
      // stored.
      if (patch.containsKey('name')) {
        row['name'] = (patch['name'] as String).trim();
      }
      if (patch.containsKey('email')) {
        final String stated = (patch['email'] as String).trim();
        row['email'] = stated.isEmpty ? null : stated.toLowerCase();
      }
      return (
        200,
        jsonEncode(<String, dynamic>{
          'success': true,
          'profile': <String, dynamic>{
            'id': row['id'],
            'name': row['name'],
            'phone': row['phone'],
            'email': row['email'],
            'createdAt': '2026-09-01T10:00:00.000Z',
            'updatedAt': '2026-10-07T11:00:00.000Z',
          },
          'changed': patch.keys.toList(),
          'dataSource': 'postgres',
          'persisted': true,
        })
      );
    }
    if (path.contains('/auth/me')) {
      if (!profileOk) {
        return (500, jsonEncode({'success': false, 'error': 'store unavailable'}));
      }
      return (
        200,
        jsonEncode(<String, dynamic>{
          'success': true,
          'role': 'CUSTOMER',
          'user': row,
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

  group('profile editing', () {
    const Key nameKey = ValueKey('profileNameField');
    const Key emailKey = ValueKey('profileEmailField');
    const Key saveKey = ValueKey('saveProfileButton');
    const Key failureKey = ValueKey('profileEditFailure');
    const Key editKey = ValueKey('editProfileDetails');

    Future<void> openEditor(WidgetTester tester) async {
      await tester.tap(find.byKey(editKey));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
    }

    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 14; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
    }

    Map<String, dynamic> sentPatch(WidgetTester tester) {
      final body = stubBodyFor('PATCH', '/customer/profile');
      expect(body, isNotNull, reason: 'no PATCH left the process');
      return jsonDecode(body!) as Map<String, dynamic>;
    }

    testWidgets('the editor opens on the values the profile read returned',
        (tester) async {
      serve();
      await pumpProfile(tester);
      expect(stubSaw('GET', '/auth/me'), isTrue);

      await openEditor(tester);

      expect(find.byKey(nameKey), findsOneWidget);
      expect(find.byKey(emailKey), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(nameKey)).controller!.text,
          'Lalthanmawli Vanminuwa');
      expect(tester.widget<TextField>(find.byKey(emailKey)).controller!.text,
          'lalthan@example.in');
      // An edit affordance that cannot be painted on a phone is not an affordance.
      expect(tester.takeException(), isNull);
    });

    testWidgets('editing the name sends it and shows the stored result',
        (tester) async {
      serve();
      await pumpProfile(tester);
      await openEditor(tester);

      await tester.enterText(find.byKey(nameKey), 'Zonamthang Ralte');
      await tester.tap(find.byKey(saveKey));
      await settle(tester);

      expect(stubSaw('PATCH', '/customer/profile'), isTrue);
      expect(sentPatch(tester)['name'], 'Zonamthang Ralte');
      expect(find.byKey(nameKey), findsNothing, reason: 'the sheet closes only on a 200');
      expect(find.text('Zonamthang Ralte'), findsWidgets);
    });

    testWidgets('the card shows what the server stored, not what was typed',
        (tester) async {
      serve();
      await pumpProfile(tester);
      await openEditor(tester);

      await tester.enterText(find.byKey(emailKey), '  Zonam@Example.IN  ');
      await tester.tap(find.byKey(saveKey));
      await settle(tester);

      // Padding and case go up as the customer wrote them, because trimming and
      // case-folding are the backend's rule; what comes back is the stored form.
      expect(sentPatch(tester)['email'], '  Zonam@Example.IN  ');
      expect(find.text('zonam@example.in'), findsWidgets);
      expect(find.text('  Zonam@Example.IN  '), findsNothing);
      expect(find.text('+91 94360 11223'), findsWidgets,
          reason: 'the phone on the row is not the profile write\'s to change');
    });

    testWidgets('the save is visibly in flight while the write is outstanding',
        (tester) async {
      serve();
      await pumpProfile(tester);
      await openEditor(tester);
      // Delay only the write, so the reads above still land.
      stubDelay = const Duration(seconds: 3);

      await tester.enterText(find.byKey(nameKey), 'Zonamthang Ralte');
      await tester.tap(find.byKey(saveKey));
      await tester.pump();

      expect(stubSaw('PATCH', '/customer/profile'), isTrue);
      expect(find.text('Saving…'), findsOneWidget);
      expect(tester.widget<ElevatedButton>(find.byKey(saveKey)).onPressed, isNull,
          reason: 'a second tap must not fire a second write');
      // Judged by the avatar's initials, not by the name on screen: the field itself holds
      // the typed text, so "the new name is nowhere" would fail for the right reason only
      // by accident. `LV` is painted from `_user`, which only a 200 is allowed to change.
      expect(find.text('ZR'), findsNothing,
          reason: 'nothing is claimed as saved before the server answers');
      expect(find.text('LV'), findsWidgets);

      await tester.pump(const Duration(seconds: 4));
      await settle(tester);
      expect(find.text('Saving…'), findsNothing);
      expect(find.text('Zonamthang Ralte'), findsWidgets);
    });

    testWidgets('a validation refusal is read out and nothing looks saved',
        (tester) async {
      serve(
        profilePatchStatus: 400,
        profilePatchCode: 'INVALID_CUSTOMER_PROFILE',
        profilePatchError: 'name must be at most 100 characters',
      );
      await pumpProfile(tester);
      await openEditor(tester);

      await tester.enterText(find.byKey(nameKey), 'x' * 101);
      await tester.tap(find.byKey(saveKey));
      await settle(tester);

      expect(stubSaw('PATCH', '/customer/profile'), isTrue);
      expect(find.byKey(failureKey), findsOneWidget);
      expect(find.textContaining('name must be at most 100 characters'), findsOneWidget);
      expect(find.byKey(nameKey), findsOneWidget, reason: 'the editor stays open for a fix');
      expect(find.text('Lalthanmawli Vanminuwa'), findsWidgets,
          reason: 'the card keeps the stored name behind the refusal');
    });

    testWidgets('a duplicate email is refused as the conflict the server called it',
        (tester) async {
      serve(profilePatchStatus: 409);
      await pumpProfile(tester);
      await openEditor(tester);

      await tester.enterText(find.byKey(emailKey), 'someone.else@example.in');
      await tester.tap(find.byKey(saveKey));
      await settle(tester);

      expect(stubSaw('PATCH', '/customer/profile'), isTrue);
      expect(find.byKey(failureKey), findsOneWidget);
      expect(find.textContaining('already belongs to a NABIN account'), findsOneWidget);
      expect(find.text('lalthan@example.in'), findsWidgets,
          reason: 'the address on the row survives the refused change');
    });

    testWidgets('a write that never reached the platform is not reported as saved',
        (tester) async {
      serve(profilePatchAnswers: false);
      await pumpProfile(tester);
      await openEditor(tester);

      await tester.enterText(find.byKey(nameKey), 'Zonamthang Ralte');
      await tester.tap(find.byKey(saveKey));
      await settle(tester);

      expect(find.byKey(failureKey), findsOneWidget);
      expect(find.textContaining("couldn't reach the platform"), findsOneWidget);
      expect(find.text('ZR'), findsNothing,
          reason: 'the card is painted from the read, and the read never changed');
      expect(find.text('LV'), findsWidgets);
      expect(find.byKey(nameKey), findsOneWidget,
          reason: 'the editor stays open so the customer can try again');
    });

    testWidgets('nothing but name and email is ever sent', (tester) async {
      serve();
      await pumpProfile(tester);
      await openEditor(tester);

      await tester.enterText(find.byKey(nameKey), 'Zonamthang Ralte');
      await tester.tap(find.byKey(saveKey));
      await settle(tester);

      final sent = sentPatch(tester);
      expect(sent.keys.toSet(), <String>{'name', 'email'});
      for (final String field in <String>[
        'wallet_balance', 'walletBalance', 'account_status', 'identity_status',
        'phone', 'dob', 'address', 'rating', 'role', 'id', 'uuid', 'user_id', 'userId',
      ]) {
        expect(sent.containsKey(field), isFalse,
            reason: '$field is not the customer\'s to send on this screen');
      }
    });

    testWidgets('an emptied email is sent as not stated, not as a fake address',
        (tester) async {
      serve();
      await pumpProfile(tester);
      await openEditor(tester);

      await tester.enterText(find.byKey(emailKey), '');
      await tester.tap(find.byKey(saveKey));
      await settle(tester);

      expect(sentPatch(tester)['email'], '');
      expect(find.text('lalthan@example.in'), findsNothing,
          reason: 'the server stored NULL, so the card must stop painting an address');
    });

    testWidgets('no editor is offered while the profile read has failed',
        (tester) async {
      serve(profileOk: false);
      await pumpProfile(tester);

      expect(stubSaw('GET', '/auth/me'), isTrue);
      expect(find.byKey(editKey), findsNothing,
          reason: 'editing values that were never read would be guessing at them');
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
