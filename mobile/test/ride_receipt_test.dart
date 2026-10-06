import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/features/ride/presentation/screens/ride_receipt_screen.dart';

// The receipt is the terminal node of the ride journey, reached once from the tracking screen
// on TRIP_COMPLETED. It prints the four values the booking and the trip actually produced
// (job id, vehicle, the quoted fare) and nothing else: no tax breakdown, no payment
// confirmation, no refund id, no rating submission — none of those has a customer route.
//
// The fare arrives through the router's `_fareLabel`, which returns '' when the booking handed
// over no fare. A blank value row reads as a bug and `₹0.00` would read as a number the
// platform never set, so an absent fare renders as a dash.

Future<void> pumpReceipt(
  WidgetTester tester, {
  String? jobId = 'RIDE-2026-0007',
  String fare = '₹386.00',
  String vehicleType = '3W',
  String vehicleName = 'Auto',
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: RideReceiptScreen(
        jobId: jobId,
        fare: fare,
        vehicleType: vehicleType,
        vehicleName: vehicleName,
      ),
    ),
  );
  await tester.pump();
}

void main() {
  group('the fields it was handed', () {
    testWidgets('prints the job, the vehicle and the quoted fare', (tester) async {
      await pumpReceipt(tester);

      expect(find.text('RIDE-2026-0007'), findsOneWidget);
      expect(find.text('Auto · 3W'), findsOneWidget);
      expect(find.text('₹386.00'), findsOneWidget);
      expect(find.text('Upfront fare'), findsOneWidget);
    });

    testWidgets('an absent fare is a dash, never a zero it invented',
        (tester) async {
      await pumpReceipt(tester, fare: '');

      expect(find.text('₹0.00'), findsNothing);
      expect(find.text('—'), findsOneWidget);
    });

    testWidgets('an absent job id is admitted, not filled with a placeholder',
        (tester) async {
      await pumpReceipt(tester, jobId: null);

      expect(find.text('TRIP-772'), findsNothing);
      expect(find.text('—'), findsOneWidget);
    });
  });

  group('nothing invented', () {
    testWidgets('no payment, tax, refund or rating claim', (tester) async {
      await pumpReceipt(tester);

      for (final String claim in <String>[
        'Paid',
        'Payment received',
        'NABIN Wallet',
        'Autopay',
        'GST',
        'Tax',
        'Refund',
        'Rating',
        'Rate',
        'Distance',
        '₹85.00',
      ]) {
        expect(find.textContaining(claim), findsNothing,
            reason: '$claim has no route behind it');
      }

      expect(find.textContaining('No online payment'), findsOneWidget);
      expect(find.textContaining('Full trip details are in Activity'), findsOneWidget);
    });
  });
}
