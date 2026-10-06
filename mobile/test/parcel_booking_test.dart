import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/parcel/presentation/screens/parcel_booking_screen.dart';
import 'package:mobile/features/parcel/presentation/screens/parcel_confirmation_screen.dart';

import 'support/http_stub.dart';

// `POST /api/customer/book-parcel` refuses an end that has no coordinate: the
// platform runs no geocoder and no routing service, so a typed label is not
// something it could price a trip from, and completing one itself would put a
// place on the record that the customer never chose. That route guarantee is
// pinned from the server side by `backend/place_substitution_test.js`
// (`PLACE-01`..`PLACE-05`) and by `test_suite.js`; what this file holds is the
// app half — the screen does not offer a booking it knows the route will refuse,
// and it sends the coordinates the customer placed rather than a label alone.
//
// The screen also used to send `senderAddress` / `recipientAddress` (keys the
// route never looks at) with a sample flat and Rifuhian Plaza in them, price the
// trip itself (₹40 / ₹65 / ₹110 per weight band) while the server computes the
// fare, describe the parcel as "Electronics Box (1.4 kg, Fragile)" on the
// customer's behalf, and promise a dual-OTP loss-free handover the backend does
// not implement.
//
// What is real: the route binds the job to the authenticated session, derives
// distance and duration from the two placed points, prices it with
// `db.calculateFareEstimate`, stores one `deliveryOtp`, and answers `{ success, job }`.

const String _pickupHint = 'House / flat, street or area, Aizawl';
const String _dropHint = 'House / shop, street or area, Aizawl';
const String _receiverHint = 'Who receives it, and their +91 number';
const String _packageHint = 'Anything the courier should know, in your own words';
const String _pickupUnplaced = 'No pickup place chosen yet';
const String _dropUnplaced = 'No drop-off place chosen yet';
const String _canBookLabel = 'Book courier delivery';
const String _waitingLabel =
    'Type both addresses and place both points on the map';

/// The two points this run places. Both are inside Aizawl, and the app is expected
/// to send these numbers and no others.
const LatLng _pickupPoint = LatLng(23.35950, 92.93760);
const LatLng _dropPoint = LatLng(23.34410, 92.95320);

Map<String, dynamic>? _bookReply;
int _bookStatus = 200;

/// Every title the screen asked the picker to open with, in order. A booking has
/// two ends, and a test that placed both blindly could not tell which end the
/// screen thought it was asking about.
final List<String> _pickerTitles = <String>[];

/// The points each call handed back, keyed by title, so a test can make the picker
/// refuse (`null`) for one end only.
LatLng? Function(String title)? _reply;

void serve() {
  _bookStatus = 200;
  _bookReply = <String, dynamic>{
    'success': true,
    'job': <String, dynamic>{
      'id': 'JOB-PARCEL-2026-0091',
      'fare': 92.5,
    },
  };
  _pickerTitles.clear();
  _reply = (title) => title.contains('collected') ? _pickupPoint : _dropPoint;
  stubHandler = (method, url, body) {
    if (url.path.contains('/customer/book-parcel')) {
      return (_bookStatus, jsonEncode(_bookReply!));
    }
    return (200, '{"success":true}');
  };
}

Future<LatLng?> fakePicker(BuildContext context,
    {LatLng? initial, required String title, required String hint}) async {
  _pickerTitles.add(title);
  return _reply?.call(title);
}

Future<void> pumpBooking(WidgetTester tester) async {
  tester.view.physicalSize = const Size(390 * 3, 1800 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final router = GoRouter(
    initialLocation: '/parcel',
    routes: <RouteBase>[
      GoRoute(
        path: '/parcel',
        builder: (context, state) =>
            const ParcelBookingScreen(placePicker: fakePicker),
      ),
      GoRoute(
        path: '/parcel-confirmation',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>?;
          return ParcelConfirmationScreen(
            jobId: extra?['jobId'] as String?,
            fare: (extra?['fare'] as String?) ?? '—',
          );
        },
      ),
    ],
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Finder fieldByHint(String hint) =>
    find.ancestor(of: find.text(hint), matching: find.byType(TextField));

Finder rowWithText(String text) => find.ancestor(
    of: find.text(text), matching: find.byType(InkWell));

/// Taps the place row for one end and lets the fake picker answer it.
Future<void> place(WidgetTester tester, {required bool isSender}) async {
  await tester.tap(rowWithText(isSender ? _pickupUnplaced : _dropUnplaced));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 60));
}

Future<void> typeAll(WidgetTester tester) async {
  await tester.enterText(fieldByHint(_pickupHint), 'RC Bualtanrmi, Tuikual, Aizawl');
  await tester.enterText(fieldByHint(_dropHint), 'Siahan Veng, Aizawl');
  await tester.enterText(fieldByHint(_receiverHint), 'Zodhanliana • 94361 20145');
  await tester.pump();
}

/// The trip as the route needs it: both ends named, and both ends placed.
Future<void> fillAndPlace(WidgetTester tester) async {
  await typeAll(tester);
  await place(tester, isSender: true);
  await place(tester, isSender: false);
}

Map<String, dynamic> body() {
  final raw = stubBodyFor('POST', '/customer/book-parcel');
  expect(raw, isNotNull, reason: 'no booking request left the app');
  return jsonDecode(raw!) as Map<String, dynamic>;
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serve();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{
        'id': 'usr_real_42',
        'name': 'Lalthanmawli Vanminuwa',
        'phone': '+91 98620 11223',
      },
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('the placement gate', () {
    testWidgets('says both ends need a place, not just a label',
        (tester) async {
      await pumpBooking(tester);
      expect(find.text(_pickupUnplaced), findsOneWidget);
      expect(find.text(_dropUnplaced), findsOneWidget);
      expect(find.text(_waitingLabel), findsOneWidget);

      // Typing every word is not placing either end.
      await typeAll(tester);
      expect(
        tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNull,
      );
      expect(find.text(_waitingLabel), findsOneWidget);

      await place(tester, isSender: true);
      expect(
        tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNull,
        reason: 'one placed end and one typed end is still an unbookable trip',
      );

      await place(tester, isSender: false);
      expect(find.text(_canBookLabel), findsOneWidget);
    });

    testWidgets('asks the map which end it is placing', (tester) async {
      await pumpBooking(tester);
      await typeAll(tester);
      await place(tester, isSender: true);
      await place(tester, isSender: false);

      expect(_pickerTitles, <String>[
        'Where should the parcel be collected?',
        'Where should the parcel be delivered?',
      ]);
    });

    testWidgets('sends the coordinates that were placed, and no others',
        (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      final map = body();
      final sender = map['senderDetails'] as Map<String, dynamic>;
      final recipient = map['recipientDetails'] as Map<String, dynamic>;
      expect(sender['lat'], _pickupPoint.latitude);
      expect(sender['lng'], _pickupPoint.longitude);
      expect(recipient['lat'], _dropPoint.latitude);
      expect(recipient['lng'], _dropPoint.longitude);
    });

    testWidgets('shows the point that will be sent on the row it belongs to',
        (tester) async {
      await pumpBooking(tester);
      await typeAll(tester);
      await place(tester, isSender: true);

      expect(find.text('Placed at 23.35950, 92.93760'), findsOneWidget);
      expect(find.text(_pickupUnplaced), findsNothing);
      // The other end is still unplaced, and still says so.
      expect(find.text(_dropUnplaced), findsOneWidget);
    });

    testWidgets('a refused picker leaves the end unplaced', (tester) async {
      // The customer can dismiss the sheet without dropping a pin. Nothing may
      // stand in for the point they did not choose.
      _reply = (_) => null;
      await pumpBooking(tester);
      await typeAll(tester);
      await place(tester, isSender: true);
      await place(tester, isSender: false);

      expect(find.text(_pickupUnplaced), findsOneWidget);
      expect(find.text(_dropUnplaced), findsOneWidget);
      expect(
        tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNull,
      );
      expect(stubSaw('POST', '/customer/book-parcel'), isFalse);
    });

    testWidgets('a pin with no typed label is named by its coordinate',
        (tester) async {
      // The route needs an address string as well as a point, and the only
      // honest text for a place the customer marked on the map is the mark
      // itself — not an area, landmark or city the app guessed around it.
      // Who receives the parcel is still asked for: a pin says where, not whom.
      await pumpBooking(tester);
      await tester.enterText(fieldByHint(_receiverHint), 'Zodhanliana • 94361 20145');
      await tester.pump();
      await place(tester, isSender: true);
      await place(tester, isSender: false);
      expect(find.text(_canBookLabel), findsOneWidget);

      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      final map = body();
      final sender = map['senderDetails'] as Map<String, dynamic>;
      final recipient = map['recipientDetails'] as Map<String, dynamic>;
      expect(sender['address'], 'Pinned at 23.35950, 92.93760');
      expect(recipient['address'], 'Pinned at 23.34410, 92.95320');
      expect(sender['lat'], _pickupPoint.latitude);
      expect(recipient['lng'], _dropPoint.longitude);
    });
  });

  group('the write path', () {
    testWidgets('sends nothing until the trip is typed', (tester) async {
      await pumpBooking(tester);
      expect(find.text(_waitingLabel), findsOneWidget);
      expect(
        tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNull,
      );
      await tester.tap(find.byType(ElevatedButton));
      await tester.pump();
      expect(stubSaw('POST', '/customer/book-parcel'), isFalse);
    });

    testWidgets('sends the typed addresses under the keys the route reads',
        (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      expect(stubSaw('POST', '/customer/book-parcel'), isTrue);
      final map = body();
      final sender = map['senderDetails'] as Map<String, dynamic>;
      final recipient = map['recipientDetails'] as Map<String, dynamic>;
      expect(sender['address'], 'RC Bualtanrmi, Tuikual, Aizawl');
      expect(recipient['address'], 'Siahan Veng, Aizawl');
      expect(recipient['name'], 'Zodhanliana • 94361 20145');
    });

    testWidgets('records no address the customer did not type', (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      final raw = stubBodyFor('POST', '/customer/book-parcel')!;
      for (final banned in <String>[
        'Delhi',
        'Kamla Nagar',
        'Karol Bagh',
        'Tuikual, Aizawl (Rahul', // the old sample sender
        'Rifuhian Plaza',
      ]) {
        expect(raw.contains(banned), isFalse, reason: '$banned reached the payload');
      }
      // `senderAddress` / `recipientAddress` were the keys the route ignores.
      final map = body();
      expect(map.containsKey('senderAddress'), isFalse);
      expect(map.containsKey('recipientAddress'), isFalse);
      // The trip's length and duration are measured by the route from the two
      // placed points; the app never had a number to offer for them.
      expect(map.containsKey('distance'), isFalse);
      expect(map.containsKey('duration'), isFalse);
    });

    testWidgets('books as the session, never a guessed customer id',
        (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      final map = body();
      expect(map.containsKey('customerId'), isFalse);
      // The sender half of the trip is named from the session, not a sample person.
      final sender = map['senderDetails'] as Map<String, dynamic>;
      expect(sender['name'], 'Lalthanmawli Vanminuwa');
      expect(sender['phone'], '+91 98620 11223');
    });

    testWidgets('prints the refusal instead of a confirmation', (tester) async {
      _bookStatus = 423;
      _bookReply = <String, dynamic>{
        'success': false,
        'error': 'NABIN Parcel Courier delivery is temporarily paused.',
      };
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      expect(find.text('NABIN Parcel Courier delivery is temporarily paused.'),
          findsOneWidget);
      expect(find.text('Parcel booked'), findsNothing);
    });
  });

  group('the parcel itself', () {
    testWidgets('sends the band the customer tapped, in their words',
        (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text('Heavy (10 - 20kg)'));
      await tester.pump();
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      expect(body()['weightTier'], 'Heavy (10 - 20kg)');
    });

    testWidgets('sends no description the customer did not give',
        (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      final map = body();
      expect(map.containsKey('packageDetails'), isFalse);
      expect(
        stubBodyFor('POST', '/customer/book-parcel')!
            .contains('Electronics Box (1.4 kg, Fragile)'),
        isFalse,
      );
    });

    testWidgets('sends the description the customer wrote, verbatim',
        (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.enterText(fieldByHint(_packageHint), 'Two glass jars, pack them sideways');
      await tester.pump();
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();

      expect(body()['packageDetails'], 'Two glass jars, pack them sideways');
    });
  });

  group('the money', () {
    testWidgets('claims no fare before the booking is written', (tester) async {
      await pumpBooking(tester);
      for (final claimed in <String>['₹40', '₹65', '₹110']) {
        expect(find.text(claimed), findsNothing);
      }
      expect(find.textContaining('• ₹'), findsNothing);
    });

    testWidgets('says the platform works the fare out', (tester) async {
      await pumpBooking(tester);
      expect(find.textContaining('the fare is the platform'), findsOneWidget);
    });

    testWidgets('hands the confirmation the fare on the job row',
        (tester) async {
      await pumpBooking(tester);
      await fillAndPlace(tester);
      await tester.tap(find.text(_canBookLabel));
      await tester.pump();
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }

      expect(find.text('Parcel booked'), findsOneWidget);
      expect(find.text('Fare on the booking'), findsOneWidget);
      expect(find.text('₹92.50'), findsOneWidget);
      expect(find.text('JOB-PARCEL-2026-0091'), findsOneWidget);
      expect(find.text('Selected fare'), findsNothing);
    });
  });

  group('the handover claim', () {
    testWidgets('promises only the code check the backend runs',
        (tester) async {
      await pumpBooking(tester);
      expect(find.textContaining('Dual-OTP'), findsNothing);
      expect(find.textContaining('100%'), findsNothing);
      expect(find.text('Code-checked handover'), findsOneWidget);
    });

    testWidgets('names the sender from the session', (tester) async {
      await pumpBooking(tester);
      expect(find.text('Lalthanmawli Vanminuwa • +91 98620 11223'), findsOneWidget);
    });
  });

  group('layout at 390 logical px', () {
    testWidgets('paints without overflowing', (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final router = GoRouter(
        routes: <RouteBase>[
          GoRoute(
              path: '/',
              builder: (context, state) => const ParcelBookingScreen()),
        ],
      );
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      expect(tester.takeException(), isNull);
    });
  });
}
