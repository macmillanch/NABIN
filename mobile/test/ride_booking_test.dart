import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile/core/models/school_child_repository.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/widgets/place_pin_row.dart';
import 'package:mobile/features/ride/presentation/screens/ride_booking_screen.dart';

import 'support/http_stub.dart';

// `POST /api/customer/book-ride` (backend/src/server.js:3725) prices a ride from the
// two coordinates in the body and refuses an end that has none — `400 PLACE_REQUIRED`
// — because the platform runs no geocoder and no routing service. Until recently that
// route filled an unplaced end in with central Delhi and priced the trip from there,
// and this screen offered a booking it could not back: an address typed into a field,
// a fare it previewed itself, a "Nearest: 360m away • 2 mins ETA" line with no fleet
// read behind it, and a school child named 'Rahul Chakma' who rode on to the driver's
// tracking screen.
//
// `backend/place_substitution_test.js` (`PLACE-01`..`PLACE-05`) and `test_suite.js`
// hold the server half. This file holds the app half, and it can hold it because
// `RideBookingScreen` takes its pin picker as a dependency (`placePicker`): the gate
// — an unplaced end is not bookable, and a placed one travels as the exact coordinate
// it was placed at — is measured here rather than reviewed.
//
// What is real, end to end: the ends come from a saved child/school row that NABIN
// returned with coordinates, or from a pin the customer dropped on the map; the route
// binds the job to the bearer token, measures the trip between the two points, sets
// the fare, mints `jobs.start_otp`, and answers `{ success, job }`.

const String _pickupEmpty = 'Tap to choose the pickup place';
const String _dropEmpty = 'Tap to choose the drop place';
const String _pickupNeeds =
    'Pickup still needs a place on the map. Tap it and choose the exact point.';
const String _dropNeeds =
    'Drop still needs a place on the map. Tap it and choose the exact point.';
const String _pickupTitle = 'Where should the ride start?';
const String _dropTitle = 'Where should the ride end?';
const String _chooseOnMap = 'Choose on the map';
const String _sheetPickupRow = 'No pickup place chosen yet';
const String _sheetDropRow = 'No drop place chosen yet';
const String _applySheet = 'Apply Changes to this Ride';
const String _pickupFieldHint = 'House / flat, lane and locality';
const String _confirmForMe = 'Confirm Auto';
const String _confirmSchool = 'Book School Ride • Auto';

/// The two points this run places. Both are Aizawl addresses' neighbours, and neither
/// is the coordinate pair the route used to substitute (28.6853, 77.2185).
const LatLng _pickupPoint = LatLng(23.34810, 92.93205);
const LatLng _dropPoint = LatLng(23.36375, 92.94130);

/// The account's own rows, used by the saved-place tests. The school sits well away
/// from the city centre on purpose: a ride that ends at the school must end at
/// 23.7080, 92.7270 and nowhere the screen guessed.
const double _schoolLat = 23.7080;
const double _schoolLng = 92.7270;
const double _childPickupLat = 23.3500;
const double _childPickupLng = 92.9300;

Map<String, dynamic>? _bookReply;
int _bookStatus = 200;
final List<String> _pickerTitles = <String>[];
final Map<String, LatLng?> _pickerInitial = <String, LatLng?>{};

/// The point each open hands back, keyed by the title, so a test can make the picker
/// refuse (`null`) for one end only.
LatLng? Function(String title)? _reply;

/// One of the override sheet's fields, found while it is still empty and painting its
/// hint. Deliberately not positional (`byType(TextField).at(4)`): a position silently
/// retargets the moment the sheet gains or reorders a field, and the test would then
/// type into the wrong one and still pass. A hint finder fails loudly in that case —
/// it stops matching once the field holds text, which is exactly when this is used:
/// before the customer has typed anything.
Finder sheetField(String hint) =>
    find.ancestor(of: find.text(hint), matching: find.byType(TextField));

/// Saved rows the fake `/api/schools` + `/api/children` reads return. Empty by
/// default: an account with nothing saved is the common case, and the screen must
/// still be bookable through the map.
List<Map<String, dynamic>> _schoolRows = <Map<String, dynamic>>[];
List<Map<String, dynamic>> _childRows = <Map<String, dynamic>>[];

void serve({bool withSavedChild = true, bool withSavedSchool = true}) {
  _bookStatus = 200;
  _bookReply = <String, dynamic>{
    'success': true,
    'job': <String, dynamic>{
      'uuid': 'JOB-RIDE-2026-0042',
      'fare': 148.5,
    },
  };
  _pickerTitles.clear();
  _pickerInitial.clear();
  _reply = (title) => title == _pickupTitle ? _pickupPoint : _dropPoint;

  _schoolRows = withSavedSchool
      ? <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'sch_seed',
            'name': 'Modern English School',
            'address': 'Bethalen, Aizawl',
            'latitude': _schoolLat,
            'longitude': _schoolLng,
            'isFavorite': true,
            'generalTimingSummary': '8:00 AM – 2:00 PM • Mon–Fri',
            'customDayTimings': <dynamic>[],
          },
        ]
      : <Map<String, dynamic>>[];
  _childRows = withSavedChild
      ? <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'chd_seed',
            'fullName': 'Zoramthanga',
            'gradeClass': 'Class 6',
            'guardianName': 'Laltluanga',
            'guardianPhone': '+91 94360 00000',
            'defaultPickupAddress': 'Tuikuan, Aizawl',
            'pickupLat': _childPickupLat,
            'pickupLng': _childPickupLng,
            // Linked to the school above, unless a test asks for the row that is gone.
            'schoolId': withSavedSchool ? 'sch_seed' : 'sch_deleted',
            'schoolName': 'Modern English School',
          },
        ]
      : <Map<String, dynamic>>[];

  stubHandler = (method, url, body) {
    final path = url.path;
    if (path.contains('/customer/book-ride')) {
      return (_bookStatus, jsonEncode(_bookReply!));
    }
    if (path.endsWith('/schools')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'schools': _schoolRows,
      }));
    }
    if (path.endsWith('/children')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'children': _childRows,
      }));
    }
    return (200, '{"success":true}');
  };
}

Future<LatLng?> fakePicker(BuildContext context,
    {LatLng? initial, required String title, required String hint}) async {
  _pickerTitles.add(title);
  _pickerInitial[title] = initial;
  return _reply?.call(title);
}

Future<void> pumpBooking(WidgetTester tester) async {
  tester.view.physicalSize = const Size(390 * 3, 900 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final router = GoRouter(
    initialLocation: '/ride',
    routes: <RouteBase>[
      GoRoute(
        path: '/ride',
        builder: (context, state) =>
            const RideBookingScreen(placePicker: fakePicker),
      ),
      // The tracking screen reads the job over the wire; this stand-in only proves
      // which id and fare the booking handed over.
      GoRoute(
        path: '/active-ride',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>?;
          return Scaffold(
            body: Text('jobId=${extra?['jobId']} fare=${extra?['fare']}'),
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

/// Reads the account's saved rows before the screen is built, so the screen's first
/// settled listener callback selects them the way a visit from Home does.
Future<void> pumpBookingWithSavedRows(WidgetTester tester) async {
  await SchoolChildRepository.instance.load();
  await pumpBooking(tester);
}

Finder boxRow(String label) => find.ancestor(
    of: find.text(label), matching: find.byType(InkWell)).first;

/// The address line inside one of the two boxes on the screen, as opposed to the
/// same text painted on the map marker above it.
Finder boxAddress(String label, String text) => find.descendant(
    of: boxRow(label), matching: find.text(text));

/// Opens one end's search sheet and chooses the map inside it, which is the only
/// option the sheet offers an account that has nothing saved.
Future<void> placeThroughSheet(WidgetTester tester,
    {required bool isPickup}) async {
  await tester.tap(boxRow(isPickup ? 'PICKUP LOCATION' : 'DROP DESTINATION'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.tap(find.text(_chooseOnMap));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  // The sheet pops itself only when a point came back. A customer who dismisses the
  // map is still standing in the search sheet, and the modal barrier swallows any
  // tap aimed at the screen behind it — so closing it is part of the refusal path,
  // not a test convenience.
  if (tester.any(find.text(_chooseOnMap))) {
    await tester.tapAt(const Offset(20, 20));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
  }
}

/// Places both ends, which is the shortest honest path to a bookable trip.
Future<void> placeBothEnds(WidgetTester tester) async {
  await placeThroughSheet(tester, isPickup: true);
  await placeThroughSheet(tester, isPickup: false);
}

Future<void> openOverrideSheet(WidgetTester tester) async {
  await tester.tap(find.text('For Someone Else'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  await tester.tap(find.byTooltip('Edit Ride Details'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

/// Taps an end's pin row inside the override sheet. By type and position, not by its
/// text: the row reads 'No … place chosen yet' while the end is unplaced and 'Placed
/// at <lat>, <lng>' once it is not, and re-placing an end that already has a point is
/// exactly the case this has to reach.
Future<void> placeInSheet(WidgetTester tester, {required bool isPickup}) async {
  await tester.tap(find.byType(PlacePinRow).at(isPickup ? 0 : 1));
  await tester.pump();
  // The sheet stays up while the picker is open, so the row is re-tappable.
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> applySheet(WidgetTester tester) async {
  await tester.ensureVisible(find.text(_applySheet));
  await tester.pump();
  await tester.tap(find.text(_applySheet));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> book(WidgetTester tester, {String label = _confirmForMe}) async {
  // This screen reports a customised trip or a chosen saved place as a SnackBar, and
  // a SnackBar is painted over the confirm button at the foot of the Scaffold — on a
  // phone as in the test. Let the notice expire rather than tap through it.
  for (var i = 0; i < 4 && tester.any(find.byType(SnackBar)); i++) {
    await tester.pump(const Duration(seconds: 4));
    await tester.pump(const Duration(milliseconds: 500));
  }
  await tester.tap(find.text(label));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 60));
}

Map<String, dynamic> body() {
  final raw = stubBodyFor('POST', '/customer/book-ride');
  expect(raw, isNotNull, reason: 'no booking request left the app');
  return jsonDecode(raw!) as Map<String, dynamic>;
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serve();
    // A singleton across tests: one test's saved rows must not place another's ends.
    SchoolChildRepository.instance.clear();
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
    SchoolChildRepository.instance.clear();
  });

  group('the placement gate', () {
    testWidgets('says the pickup needs a place before the drop does',
        (tester) async {
      await pumpBooking(tester);

      expect(find.text(_pickupEmpty), findsOneWidget);
      expect(find.text(_dropEmpty), findsOneWidget);
      expect(find.text(_pickupNeeds), findsOneWidget);
      expect(find.text(_dropNeeds), findsNothing);

      await placeThroughSheet(tester, isPickup: true);
      expect(find.text(_pickupNeeds), findsNothing);
      expect(find.text(_dropNeeds), findsOneWidget);

      await placeThroughSheet(tester, isPickup: false);
      expect(find.text(_dropNeeds), findsNothing);
      // Both boxes now name the place they hold, not the prompt.
      expect(find.text(_pickupEmpty), findsNothing);
      expect(find.text(_dropEmpty), findsNothing);
    });

    testWidgets('asks the map which end it is placing', (tester) async {
      await pumpBooking(tester);
      await placeBothEnds(tester);

      expect(_pickerTitles, <String>[_pickupTitle, _dropTitle]);
    });

    testWidgets('opens the map on the place the end already has',
        (tester) async {
      await pumpBookingWithSavedRows(tester);
      await openOverrideSheet(tester);

      // Re-placing an end that has a point must show the customer where that point
      // is, not the middle of the city, or "Move" puts the ride somewhere else
      // without saying so.
      await placeInSheet(tester, isPickup: true);
      expect(_pickerInitial[_pickupTitle], const LatLng(_childPickupLat, _childPickupLng));
    });

    testWidgets('books nothing when neither end is placed', (tester) async {
      await pumpBooking(tester);
      await book(tester);

      expect(
        find.textContaining('Place the pickup on the map first.'),
        findsOneWidget,
      );
      expect(stubSaw('POST', '/customer/book-ride'), isFalse);
    });

    testWidgets('names the end that is still missing', (tester) async {
      await pumpBooking(tester);
      await placeThroughSheet(tester, isPickup: true);
      await book(tester);

      expect(find.textContaining('Place the drop on the map first.'), findsOneWidget);
      expect(stubSaw('POST', '/customer/book-ride'), isFalse);
    });

    testWidgets('a refused picker leaves the end unplaced', (tester) async {
      // The customer can dismiss the sheet without dropping a pin. Nothing may stand
      // in for the point they did not choose.
      _reply = (_) => null;
      await pumpBooking(tester);
      await placeBothEnds(tester);

      expect(find.text(_pickupEmpty), findsOneWidget);
      expect(find.text(_dropEmpty), findsOneWidget);
      expect(find.text(_pickupNeeds), findsOneWidget);
      await book(tester);
      expect(stubSaw('POST', '/customer/book-ride'), isFalse);
    });

    testWidgets('sends the coordinates that were placed, and no others',
        (tester) async {
      await pumpBooking(tester);
      await placeBothEnds(tester);
      await book(tester);

      final map = body();
      final pickup = map['pickup'] as Map<String, dynamic>;
      final drop = map['drop'] as Map<String, dynamic>;
      expect(pickup['lat'], _pickupPoint.latitude);
      expect(pickup['lng'], _pickupPoint.longitude);
      expect(drop['lat'], _dropPoint.latitude);
      expect(drop['lng'], _dropPoint.longitude);
    });

    testWidgets('records no place the customer did not choose', (tester) async {
      await pumpBooking(tester);
      await placeBothEnds(tester);
      await book(tester);

      final raw = stubBodyFor('POST', '/customer/book-ride')!;
      for (final banned in <String>[
        'Delhi',
        'Kamla Nagar',
        '28.68', // the pair the route substituted for an unplaced end
        '77.21',
        'Rahul', // the passenger this screen used to invent
        'cust_active', // an id that is not an account
        'TRIP-772',
      ]) {
        expect(raw.contains(banned), isFalse, reason: '$banned reached the payload');
      }
      // The route binds the booking to the bearer token and rejects a mismatched id,
      // so a client-supplied customerId adds nothing.
      expect(body().containsKey('customerId'), isFalse);
    });

    testWidgets('a pin with no label is named by its coordinate',
        (tester) async {
      // The route wants an address string as well as a point, and the only honest
      // text for a place marked on the map is the mark itself — not an area,
      // landmark or city the app guessed around it.
      await pumpBooking(tester);
      await placeBothEnds(tester);
      await book(tester);

      final pickup = body()['pickup'] as Map<String, dynamic>;
      final drop = body()['drop'] as Map<String, dynamic>;
      expect(pickup['address'], 'Pinned at 23.34810, 92.93205');
      expect(drop['address'], 'Pinned at 23.36375, 92.94130');
    });

    testWidgets('claims no fare, ETA or nearby fleet it cannot source',
        (tester) async {
      await pumpBooking(tester);
      expect(find.textContaining('₹'), findsNothing);
      expect(find.textContaining('Nearest:'), findsNothing);
      expect(find.textContaining('ETA'), findsNothing);
      expect(
        find.textContaining('NABIN sets the fare when it confirms the ride'),
        findsOneWidget,
      );
    });
  });

  group('the override sheet', () {
    testWidgets('keeps a pin placed from an empty address field', (tester) async {
      // The sheet copies its own text fields back over the trip when it applies, and
      // an address whose text changed loses its point — right, for a platform that
      // cannot geocode. But a pin dropped on an empty field was invisible to that
      // check: the field never saw the pin, so Apply restored the blank text and
      // silently threw away the place the customer had just chosen.
      await pumpBooking(tester);
      await openOverrideSheet(tester);
      expect(find.text(_sheetPickupRow), findsOneWidget);
      expect(find.text(_sheetDropRow), findsOneWidget);

      await placeInSheet(tester, isPickup: true);
      expect(find.text('Placed at 23.34810, 92.93205'), findsOneWidget);
      await placeInSheet(tester, isPickup: false);
      expect(find.text('Placed at 23.36375, 92.94130'), findsOneWidget);

      await applySheet(tester);

      expect(find.text(_pickupNeeds), findsNothing);
      expect(find.text(_dropNeeds), findsNothing);
      // The box on the screen, not just the pin on the map: the customer has to see
      // the place the trip now carries.
      expect(
        boxAddress('PICKUP LOCATION', 'Pinned at 23.34810, 92.93205'),
        findsOneWidget,
      );
      expect(
        boxAddress('DROP DESTINATION', 'Pinned at 23.36375, 92.94130'),
        findsOneWidget,
      );

      await book(tester, label: _confirmSchool);
      final pickup = body()['pickup'] as Map<String, dynamic>;
      final drop = body()['drop'] as Map<String, dynamic>;
      expect(pickup['lat'], _pickupPoint.latitude);
      expect(drop['lat'], _dropPoint.latitude);
    });

    testWidgets('retyping an address drops its point', (tester) async {
      // Words the platform cannot geocode are not a place it can drive to, so the
      // point a pin carried does not survive being overwritten by typing.
      await pumpBooking(tester);
      await openOverrideSheet(tester);
      await placeInSheet(tester, isPickup: true);

      await tester.enterText(sheetField(_pickupFieldHint), 'Serkawn, Aizawl');
      await tester.pump();
      await applySheet(tester);

      expect(find.text('Serkawn, Aizawl'), findsOneWidget);
      expect(find.text(_pickupNeeds), findsOneWidget);
      await book(tester, label: _confirmSchool);
      expect(stubSaw('POST', '/customer/book-ride'), isFalse);
    });
  });

  group('saved places', () {
    testWidgets('says so when the account has nothing saved', (tester) async {
      await pumpBooking(tester);
      await tester.tap(boxRow('DROP DESTINATION'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Search Drop Location'), findsOneWidget);
      expect(find.text('No saved places on this account yet'), findsOneWidget);
      expect(find.text('Nothing saved to pick from yet.'), findsOneWidget);
      expect(find.text(_chooseOnMap), findsOneWidget);
    });

    testWidgets('books the school ride at the coordinates NABIN stored',
        (tester) async {
      await pumpBookingWithSavedRows(tester);
      await tester.tap(find.text('For Someone Else'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Zoramthanga • Class 6'), findsOneWidget);
      expect(find.textContaining(_dropNeeds), findsNothing);
      expect(find.text(_confirmSchool), findsOneWidget);

      await book(tester, label: _confirmSchool);
      final map = body();
      final pickup = map['pickup'] as Map<String, dynamic>;
      final drop = map['drop'] as Map<String, dynamic>;
      expect(pickup['lat'], _childPickupLat);
      expect(pickup['lng'], _childPickupLng);
      expect(drop['lat'], _schoolLat);
      expect(drop['lng'], _schoolLng);

      final passenger = map['passengerInfo'] as Map<String, dynamic>;
      expect(passenger['passengerName'], 'Zoramthanga');
      expect(passenger['guardianName'], 'Laltluanga');
      // No stock photo: this app has no stored passenger image, and a URL would put
      // a stranger's face on a child's trip.
      expect(passenger['passengerPhoto'], isNull);
    });

    testWidgets('a saved place picked from the sheet travels as its own point',
        (tester) async {
      await pumpBookingWithSavedRows(tester);
      await tester.tap(boxRow('DROP DESTINATION'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      // The account's school is also this trip's current drop, so the same words are
      // painted twice — once in the sheet's row and once in the box behind it. The
      // customer taps the row.
      await tester.tap(find.descendant(
        of: find.byType(ListTile),
        matching: find.text('Modern English School, Bethalen, Aizawl'),
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      await placeThroughSheet(tester, isPickup: true);
      await book(tester);

      final drop = body()['drop'] as Map<String, dynamic>;
      expect(drop['address'], 'Modern English School, Bethalen, Aizawl');
      expect(drop['lat'], _schoolLat);
      expect(drop['lng'], _schoolLng);
    });

    testWidgets('a child whose school row is gone has a name and no place',
        (tester) async {
      // `schoolFor` can only return a row the account still has. A deleted school
      // leaves the child's own `schoolName` text behind — and text is not a point,
      // so the drop has to be placed before this is bookable.
      serve(withSavedSchool: false);
      await pumpBookingWithSavedRows(tester);
      await tester.tap(find.text('For Someone Else'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Zoramthanga • Class 6'), findsOneWidget);
      expect(find.text(_dropNeeds), findsOneWidget);

      await book(tester, label: _confirmSchool);
      expect(find.textContaining('Place the drop on the map first.'), findsOneWidget);
      expect(stubSaw('POST', '/customer/book-ride'), isFalse);
    });
  });

  group('the write path', () {
    testWidgets('hands the tracking screen the job the route returned',
        (tester) async {
      await pumpBooking(tester);
      await placeBothEnds(tester);
      await book(tester);
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }

      // Without an id the tracking screen has nothing to read, and the fare shown
      // downstream has to be the one NABIN stored, not a preview from this screen.
      expect(find.textContaining('jobId=JOB-RIDE-2026-0042'), findsOneWidget);
      expect(find.textContaining('fare=148.5'), findsOneWidget);
    });

    testWidgets('prints the refusal instead of going to the trip',
        (tester) async {
      _bookStatus = 423;
      _bookReply = <String, dynamic>{
        'success': false,
        'error': 'NABIN Mobility & Rides is temporarily paused by platform operations.',
      };
      await pumpBooking(tester);
      await placeBothEnds(tester);
      await book(tester);

      expect(
        find.text('NABIN Mobility & Rides is temporarily paused by platform operations.'),
        findsOneWidget,
      );
      expect(find.textContaining('jobId='), findsNothing);
    });
  });
}
