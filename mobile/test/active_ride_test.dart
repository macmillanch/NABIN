import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/models/passenger_booking_info.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/ride/presentation/screens/active_ride_screen.dart';

import 'support/http_stub.dart';

// The screen used to own the trip. An `int _tripStage` walked itself forward through
// invented titles, and the card printed a driver off a hard-coded roster ('Rajesh Kumar',
// 'Vikram Singh', 'Amitabh Sen' with plates, ratings and dialable numbers), a start PIN of
// '7729', 'Est. Arrival: 11:58 AM • 3.2 km remaining', a speed, a mid-trip early-stop with a
// minimum-50% rule, 'Instant Refund to Wallet', a per-vehicle fee table (2W Rs 20 / 3W Rs 30
// / 4W Rs 50) and a rating bar that sent nothing.
//
// What a customer actually has for a job: `GET /api/tracking/:jobId` (status, the driver the
// row names, the last position, the pickup/drop pair), the `DRIVER_ASSIGNED` socket message
// (the only carrier of a plate and the start code — and there is no seam to inject
// one in a widget test, so these tests assert the honest behaviour when it has not arrived),
// and `POST /api/rides/:id/cancel`, whose response carries the platform's own settlement
// figures. The stage ladder mirrors `VALID_JOB_TRANSITIONS` in
// `backend/src/repositories/JobRepository.js:5-23`, and the cancellation offer appears only
// in the six states `CANCELLED` is reachable from (`:22`).
//
// Same rule as every other screen here: assert the request left before asserting content,
// because an error state also satisfies "the invented literal is gone".

const String _jobId = 'RIDE-2026-0007';

/// The stored stage. The cancel write flips it and the screen's own re-read sees the flip —
/// the screen never sets it.
String _rowStatus = 'DRIVER_ARRIVING';
Map<String, dynamic>? _rowDriver = <String, dynamic>{
  'id': 'drv_9f21',
  'name': 'Lianlalam Ralte',
  'phone': '+919862012345',
};
Map<String, dynamic>? _rowLocation = <String, dynamic>{
  'lat': 23.7285,
  'lng': 92.7198,
  'speed': 34.5,
  'heading': 118,
};
bool _trackOk = true;
bool _cancelOk = true;

void serve() {
  stubHandler = (method, url, body) {
    if (url.path.contains('/tracking/')) {
      if (!_trackOk) {
        return (500, jsonEncode(<String, dynamic>{
          'success': false,
          'error': 'trip not found',
        }));
      }
      return (
        200,
        jsonEncode(<String, dynamic>{
          'success': true,
          'jobId': _jobId,
          'status': _rowStatus,
          'type': 'RIDE',
          'channel': 'CUSTOMER_APP',
          'driver': _rowDriver,
          'location': _rowLocation,
          'pickup': <String, dynamic>{
            'address': 'Captain No. More, Aizawl',
            'lat': 23.7271,
            'lng': 92.7176,
          },
          'drop': <String, dynamic>{
            'address': 'Chanmari, Aizawl',
            'lat': 23.7404,
            'lng': 92.7246,
          },
        })
      );
    }
    if (url.path.contains('/cancel')) {
      if (!_cancelOk) {
        return (500, jsonEncode(<String, dynamic>{
          'success': false,
          'error': 'PostgreSQL database unavailable',
        }));
      }
      // What `cancel_ride_atomic` (migration 016) returns. `driverWalletBalance` is in it
      // too — a driver's balance reaching a customer's screen, which must not be printed.
      _rowStatus = 'CANCELLED';
      return (
        200,
        jsonEncode(<String, dynamic>{
          'success': true,
          'jobId': _jobId,
          'status': 'CANCELLED',
          'cancellationFee': 50,
          'driverCompensation': 40,
          'refundAmount': 0,
          'refundStatus': 'NOT_APPLICABLE',
          'driverWalletBalance': 1250.75,
        })
      );
    }
    return (200, '{"success":true}');
  };
}

Future<void> pumpRide(
  WidgetTester tester, {
  String? jobId = _jobId,
  String fare = '₹386.00',
  PassengerBookingInfo? passenger,
}) async {
  // A phone-width column, tall enough that the whole list builds: a ListView never creates
  // the widgets below its viewport, so an assertion about the cancellation card or the
  // timeline would read as a missing claim rather than an unscrolled one.
  tester.view.physicalSize = const Size(390 * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MaterialApp(
      home: ActiveRideScreen(
        jobId: jobId,
        fare: fare,
        passengerInfo: passenger,
      ),
    ),
  );
  // No pumpAndSettle: the in-flight read paints a spinner.
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// Opens the cancellation sheet and confirms it is on screen.
Future<void> openCancelSheet(WidgetTester tester) async {
  await tester.tap(find.text('Cancel trip'));
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    _rowStatus = 'DRIVER_ARRIVING';
    _rowDriver = <String, dynamic>{
      'id': 'drv_9f21',
      'name': 'Lianlalam Ralte',
      'phone': '+919862012345',
    };
    _rowLocation = <String, dynamic>{
      'lat': 23.7285,
      'lng': 92.7198,
      'speed': 34.5,
      'heading': 118,
    };
    _trackOk = true;
    _cancelOk = true;
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

  group('the read', () {
    testWidgets('asks the backend for the trip it was handed', (tester) async {
      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
    });

    testWidgets('paints the stage the trip row reports', (tester) async {
      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      // Once as the band headline, once as the active step of the stage list.
      expect(find.text('Driver on the way'), findsNWidgets(2));
      expect(find.text('Step 4 of 7'), findsOneWidget);
      expect(find.text('#$_jobId'), findsOneWidget);
      expect(find.textContaining('The driver is heading to your pickup point'),
          findsNWidgets(2), reason: 'the banner line and that step\'s own subtitle');
    });

    testWidgets('ACCEPTED reads as the assignment step, not an unknown stage',
        (tester) async {
      _rowStatus = 'ACCEPTED';

      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('Driver assigned'), findsNWidgets(2));
      expect(find.text('Step 3 of 7'), findsOneWidget);
      expect(find.textContaining('no view for it'), findsNothing);
    });

    testWidgets('a refused read asks for a retry instead of narrating a trip',
        (tester) async {
      _trackOk = false;

      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.textContaining("couldn't load this trip"), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Driver on the way'), findsNothing);
    });

    testWidgets('a silent re-read that fails keeps the row already on screen',
        (tester) async {
      await pumpRide(tester);
      expect(find.text('Step 4 of 7'), findsOneWidget);

      _trackOk = false;
      await tester.pump(const Duration(seconds: 10));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Step 4 of 7'), findsOneWidget);
      expect(find.text('Driver on the way'), findsNWidgets(2));
      expect(find.textContaining("couldn't load this trip"), findsNothing);
    });

    testWidgets('no trip id asks for nothing and says so', (tester) async {
      await pumpRide(tester, jobId: null);

      expect(stubSeen, isEmpty);
      expect(find.textContaining('No trip to follow'), findsOneWidget);
    });

    testWidgets('an unrecognised stage reports the row instead of a guess',
        (tester) async {
      _rowStatus = 'SOMETHING_NEW';

      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('Unrecognised stage'), findsOneWidget);
      expect(find.textContaining('no view for it'), findsOneWidget);
      expect(find.textContaining('Step '), findsNothing);
    });
  });

  group('the driver', () {
    testWidgets('is the one the trip row names', (tester) async {
      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('Lianlalam Ralte'), findsOneWidget);
      expect(find.text('LR'), findsOneWidget);
      // The phone is a thing to dial, not a thing to print.
      expect(find.textContaining('+919862012345'), findsNothing);
      expect(find.text('Call driver'), findsOneWidget);
      expect(find.text('Message'), findsOneWidget);
    });

    testWidgets('shows no vehicle or rating the assignment message did not bring',
        (tester) async {
      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.textContaining('Vehicle details were not in the assignment message'),
          findsOneWidget);
      expect(find.textContaining('★'), findsNothing);
    });

    testWidgets('names nobody when the row has no driver', (tester) async {
      _rowStatus = 'SEARCHING';
      _rowDriver = null;
      _rowLocation = null;

      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('No driver yet'), findsOneWidget);
      expect(find.text('Call driver'), findsNothing);
      expect(find.textContaining('The platform names the driver when one takes the trip'),
          findsOneWidget);
      expect(find.textContaining('has not reported a position for this trip yet'),
          findsOneWidget);
    });

    testWidgets('the start code is absent until the assignment message brings it',
        (tester) async {
      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('START CODE FOR THE DRIVER'), findsNothing);
      expect(find.text('7729'), findsNothing);
    });

    testWidgets('prints the position the driver reported and no route promise',
        (tester) async {
      await pumpRide(tester);

      expect(find.textContaining('23.7285, 92.7198'), findsOneWidget);
      expect(find.textContaining('34.5 km/h'), findsOneWidget);
      expect(find.textContaining('NABIN publishes no route line'), findsOneWidget);
      expect(find.textContaining('Checked'), findsOneWidget);
    });
  });

  group('nothing invented', () {
    testWidgets('the roster, the PIN, the ETA and the fee table are all gone',
        (tester) async {
      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      for (final String claim in <String>[
        'Rajesh Kumar',
        'Vikram Singh',
        'Amitabh Sen',
        'MZ 06 RZ 1170',
        'MZ 01 BQ 4415',
        'MZ 04 CK 2088',
        '7729',
        'nabin.app/track',
        '2W Bike',
        '3W Auto: ₹',
        '4W Car: ₹',
        'Instant Refund to Wallet',
        'Simulate Drop',
        'Live GPS Guard',
        'Est. Arrival',
        'km remaining',
        'NABIN Wallet (Autopay)',
        'Driver Verifies OTP',
        'verified Start PIN',
      ]) {
        expect(find.textContaining(claim), findsNothing,
            reason: '$claim was invented with no source');
      }
    });

    testWidgets('the stage does not advance while nobody writes it',
        (tester) async {
      await pumpRide(tester);

      // Two minutes of wall clock: twelve silent re-reads of the same row.
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(seconds: 10));
      }

      expect(find.text('Step 4 of 7'), findsOneWidget);
      expect(find.text('Trip in progress'), findsOneWidget,
          reason: 'listed as a later stage, never reported as the current one');
      expect(
        stubSeen.where((s) => s.contains('/tracking/')).length,
        greaterThanOrEqualTo(2),
        reason: 'it should re-read rather than freeze',
      );
    });

    testWidgets('the timeline is labelled as written by the platform',
        (tester) async {
      await pumpRide(tester);

      expect(find.text('Trip stages'), findsOneWidget);
      expect(find.textContaining('it never advances on its own'), findsOneWidget);
    });

    testWidgets('the booking quote is labelled as a quote', (tester) async {
      await pumpRide(tester, fare: '₹386.00');

      expect(find.textContaining('Quote from the booking: ₹386.00'), findsOneWidget);
      expect(find.textContaining('The trip row read here reports no fare'),
          findsOneWidget);
      expect(find.textContaining('Paid ₹386.00'), findsNothing);
    });

    testWidgets('a screen handed no quote says so rather than showing ₹0.00',
        (tester) async {
      await pumpRide(tester, fare: '');

      expect(find.textContaining('No fare was carried into this screen'), findsOneWidget);
      expect(find.text('₹0.00'), findsNothing);
    });

    testWidgets('the addresses are the ones the row carries', (tester) async {
      await pumpRide(tester);

      expect(find.text('Captain No. More, Aizawl'), findsOneWidget);
      expect(find.text('Chanmari, Aizawl'), findsWidgets);
    });

    testWidgets('a passenger card states what it is not', (tester) async {
      await pumpRide(
        tester,
        passenger: const PassengerBookingInfo(
          bookingType: 'FOR_SOMEONE_ELSE',
          passengerCategory: 'SCHOOL_CHILD',
          passengerName: 'Zoramthanga Ralte',
          schoolName: 'Zawatah National Higher Secondary School',
          gradeClass: 'Class 8',
          guardianPhone: '+919876500000',
        ),
      );

      expect(find.text('SCHOOL CHILD PASSENGER'), findsOneWidget);
      expect(find.text('Zoramthanga Ralte'), findsOneWidget);
      expect(find.textContaining('Zawatah National Higher Secondary School • Class 8'),
          findsOneWidget);
      expect(find.textContaining('does not verify them against a school record'),
          findsOneWidget);
    });
  });

  group('cancellation', () {
    testWidgets('is offered while the trip is still cancellable', (tester) async {
      await pumpRide(tester);

      expect(find.text('Cancel trip'), findsOneWidget);
      expect(find.textContaining('This writes to the platform'), findsOneWidget);
    });

    testWidgets('is not offered once the trip is running', (tester) async {
      _rowStatus = 'IN_TRANSIT';

      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('Cancel trip'), findsNothing);
      expect(find.textContaining('cannot be cancelled'), findsOneWidget);
      expect(find.textContaining('no customer early-stop or trip-adjustment write'),
          findsOneWidget);
    });

    testWidgets('its sheet promises no amount before the write returns',
        (tester) async {
      await pumpRide(tester);
      await openCancelSheet(tester);

      // The sheet title, and the card headline still painted behind it.
      expect(find.text('Cancel this trip'), findsNWidgets(2));
      expect(
        find.textContaining('The fee is not known until the write returns'),
        findsOneWidget,
      );
      expect(find.textContaining('₹50.00'), findsNothing);
      // The quoted rule is the migration's own wording, not a per-vehicle table.
      expect(find.textContaining('costs a flat Rs 50.00'), findsOneWidget);
    });

    testWidgets('tapping cancel writes to the platform and paints what returns',
        (tester) async {
      await pumpRide(tester);
      await openCancelSheet(tester);

      await tester.tap(find.text('Change of plans / no longer needed'));
      await tester.pump();
      await tester.tap(find.text('Cancel the trip'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('POST', '/rides/$_jobId/cancel'), isTrue);
      final body = stubBodyFor('POST', '/rides/$_jobId/cancel');
      expect(body, contains('Change of plans / no longer needed'));
      expect(body, contains('"isDelayedOverride":false'));

      // The figures are the platform's, returned by the write.
      expect(find.text('Cancellation settled'), findsOneWidget);
      expect(find.textContaining('Cancellation fee'), findsOneWidget);
      expect(find.text('₹50.00'), findsOneWidget);
      expect(find.text('₹40.00'), findsOneWidget);
      expect(find.textContaining('Refund status: NOT_APPLICABLE'), findsOneWidget);
      expect(find.textContaining('These figures are what the platform wrote'),
          findsOneWidget);
      // A driver's wallet balance rides along in that response. It is not the customer's
      // to read.
      expect(find.textContaining('1250'), findsNothing);
      // The re-read sees the row flip; the screen never declares it itself.
      expect(find.text('Cancelled'), findsOneWidget);
      expect(find.text('This trip is closed'), findsOneWidget);
      expect(find.text('Closed'), findsOneWidget);
    });

    testWidgets('the late-driver declaration is sent as a declaration',
        (tester) async {
      await pumpRide(tester);
      await openCancelSheet(tester);

      await tester.tap(
          find.text('The driver has been attached for more than 2 minutes and is late'));
      await tester.pump();
      await tester.tap(find.text('Cancel the trip'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('POST', '/rides/$_jobId/cancel'), isTrue);
      expect(stubBodyFor('POST', '/rides/$_jobId/cancel'),
          contains('"isDelayedOverride":true'));
    });

    testWidgets('a refused write says nothing changed', (tester) async {
      await pumpRide(tester);
      await openCancelSheet(tester);

      _cancelOk = false;
      await tester.tap(find.text('Cancel the trip'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('POST', '/rides/$_jobId/cancel'), isTrue);
      expect(find.textContaining('The trip was not cancelled. Nothing changed'),
          findsOneWidget);
      expect(find.text('Cancellation settled'), findsNothing);
      // Still cancellable: the row was never written.
      expect(find.text('Step 4 of 7'), findsOneWidget);
    });

    testWidgets('keeping the trip writes nothing', (tester) async {
      await pumpRide(tester);
      await openCancelSheet(tester);

      await tester.tap(find.text('Keep my trip'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('POST', '/cancel'), isFalse);
      expect(find.text('Cancel trip'), findsOneWidget);
    });
  });

  group('terminal stages', () {
    testWidgets('a completed trip leads to the receipt and stops polling',
        (tester) async {
      _rowStatus = 'COMPLETED';

      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('Trip completed'), findsNWidgets(2));
      expect(find.text('Trip closed by the driver'), findsOneWidget);
      expect(find.text('View trip receipt'), findsOneWidget);
      expect(find.textContaining('Re-reads every'), findsNothing);
      expect(find.text('Cancel trip'), findsNothing);
      expect(find.textContaining('completed, so it can no longer be cancelled'),
          findsOneWidget);

      final before = stubSeen.where((s) => s.contains('/tracking/')).length;
      await tester.pump(const Duration(seconds: 60));
      expect(stubSeen.where((s) => s.contains('/tracking/')).length, before,
          reason: 'a terminal row has nothing left to re-read');
    });

    testWidgets('a trip cancelled elsewhere reads as closed, not as refundable',
        (tester) async {
      _rowStatus = 'CANCELLED';

      await pumpRide(tester);

      expect(stubSaw('GET', '/tracking/$_jobId'), isTrue);
      expect(find.text('Cancelled'), findsOneWidget);
      expect(find.textContaining('will not move again'), findsOneWidget);
      expect(find.textContaining('Step '), findsNothing);
      // Nothing here has the settlement figures — they come from the cancel write, which
      // this trip did not go through.
      expect(find.textContaining('Cancellation settled'), findsNothing);
      expect(find.textContaining('refunded'), findsNothing);
    });

    testWidgets('the safety sheet reaches no platform alert', (tester) async {
      await pumpRide(tester);

      await tester.tap(find.byIcon(Icons.shield_rounded).first);
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Dial 112'), findsOneWidget);
      expect(find.textContaining('Send the trip details by SMS'), findsOneWidget);
      expect(
        find.textContaining('no emergency-event write'),
        findsOneWidget,
      );
      // The message a passenger can send carries only what the row and the push gave.
      expect(find.textContaining('#$_jobId'), findsWidgets);
      expect(find.textContaining('Stage: DRIVER_ARRIVING'), findsOneWidget);
      expect(find.textContaining('nabin.app/track'), findsNothing);
      expect(find.textContaining('7729'), findsNothing);
      expect(stubSeen.every((s) => s.startsWith('GET ')), isTrue,
          reason: 'safety must not pretend to have notified anyone');
    });
  });
}
