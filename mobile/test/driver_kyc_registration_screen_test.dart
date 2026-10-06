import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/presentation/screens/driver_kyc_registration_screen.dart';

/// A regression lock on the driver KYC intake form.
///
/// The screen used to open already filled in — 'Rajesh Kumar', a Delhi driving licence
/// `DL-14201900192`, a Delhi registration `DL 1RA 4892`, a UPI handle, and a settlement
/// bank with an IFSC — for an applicant who had not typed anything, in a NABIN build that
/// operates in Aizawl. It captioned an untouched photo circle 'Profile Photo (Verified)',
/// reported 'Valid until Nov 2027' and 'Verified by RTO' for documents no one had read,
/// and then answered a button press with a green 'KYC Document Review Complete / APPROVED'
/// board and a jump into the driver console. There is no driver-facing KYC route to submit
/// to, so every one of those was a claim the platform had not made.
///
/// None of these assertions need the network. They are about what the device puts on
/// screen before the backend has said anything, which is where the defect lived.
void main() {
  Widget host() => const MaterialApp(
        home: Scaffold(body: DriverKycRegistrationScreen()),
      );

  const nextLabel = 'Continue to Next Step';
  const sendLabel = 'Send these details to NABIN';

  /// Every value this screen ever invented, in one list, so reintroducing one fails here
  /// rather than in a screenshot somebody has to notice.
  const fabricated = [
    'Rajesh',
    'DL-14201900192',
    '4892',
    'okhdfcbank',
    'HDFC Bank',
    'IFSC',
    'Nov 2027',
    'Verified by RTO',
  ];

  Future<void> next(WidgetTester tester) async {
    await tester.tap(find.text(nextLabel));
    await tester.pumpAndSettle();
  }

  /// Fills each step with the minimum the form accepts and walks to [targetStep].
  Future<void> advanceTo(WidgetTester tester, int targetStep) async {
    for (var step = 0; step < targetStep; step++) {
      switch (step) {
        case 0:
          await tester.enterText(find.byType(TextFormField).first, 'Lalrindama R');
        case 1:
          await tester.tap(find.text('2-Wheeler (Bike / Scooter)'));
          await tester.pump();
        case 2:
          await tester.enterText(find.byType(TextFormField).first, 'MZ0120260001234');
          await tester.enterText(find.byType(TextFormField).at(1), 'MZ 01 AB 1234');
      }
      await next(tester);
    }
  }

  group('what the form knows before anyone types', () {
    testWidgets('the name field opens empty', (tester) async {
      await tester.pumpWidget(host());

      final field = tester.widget<TextFormField>(find.byType(TextFormField).first);
      expect(field.controller!.text, isEmpty,
          reason: 'a name typed in advance is not this applicant\'s name');
    });

    testWidgets('no vehicle category is pre-selected', (tester) async {
      await tester.pumpWidget(host());

      await advanceTo(tester, 1);

      expect(find.byIcon(Icons.check_circle), findsNothing,
          reason: 'a default 3W would claim a vehicle the applicant never named');
    });

    testWidgets('the photo is captioned as not attached', (tester) async {
      await tester.pumpWidget(host());

      expect(find.text('Profile photo — not attached'), findsOneWidget);
      expect(find.textContaining('(Verified)'), findsNothing);
    });

    testWidgets('the registration field keeps what is typed, not a stand-in',
        (tester) async {
      await tester.pumpWidget(host());
      await advanceTo(tester, 2);
      await tester.enterText(find.byType(TextFormField).at(1), 'MZ 01 AB 1234');
      await tester.pump();

      final rc = tester.widget<TextFormField>(find.byType(TextFormField).at(1));
      expect(rc.controller!.text, 'MZ 01 AB 1234');
    });
  });

  group('no fabricated value on any step', () {
    for (var step = 0; step < 4; step++) {
      testWidgets('step ${step + 1} says none of the invented values', (tester) async {
        await tester.pumpWidget(host());
        await advanceTo(tester, step);

        for (final value in fabricated) {
          expect(find.textContaining(value), findsNothing, reason: '"$value" is not real');
        }
      });
    }
  });

  group('the truth about review and approval', () {
    testWidgets('nothing on the form is ever presented as approved', (tester) async {
      await tester.pumpWidget(host());
      await advanceTo(tester, 3);

      expect(find.textContaining('APPROVED'), findsNothing);
      expect(find.textContaining('Review Complete'), findsNothing);
      expect(find.textContaining('Instant Approval'), findsNothing);
      expect(find.textContaining('ready to accept jobs'), findsNothing);
    });

    testWidgets('pressing send states that nothing was sent, and changes no state',
        (tester) async {
      await tester.pumpWidget(host());
      await advanceTo(tester, 3);
      await tester.enterText(find.byType(TextFormField).first, 'lalrindama@okaxis');
      await tester.pump();

      await tester.tap(find.text(sendLabel));
      await tester.pumpAndSettle();

      expect(find.textContaining('Nothing was sent'), findsOneWidget,
          reason: 'no route exists for a driver to POST these details to');
      expect(find.textContaining('no KYC intake route'), findsOneWidget);
      // And it must not have become the approval board it used to become.
      expect(find.textContaining('APPROVED'), findsNothing);
      expect(find.text('Start Driving Now'), findsNothing);
    });

    testWidgets('an empty required field blocks the next step', (tester) async {
      await tester.pumpWidget(host());

      await next(tester);

      expect(find.textContaining('Enter the Driver Full Name'), findsOneWidget);
      expect(find.text('2. Select Vehicle Type'), findsNothing);
    });

    testWidgets('no vehicle chosen blocks the next step', (tester) async {
      await tester.pumpWidget(host());

      await advanceTo(tester, 1);
      await next(tester);

      expect(find.textContaining('Choose the vehicle category'), findsOneWidget);
      expect(find.text('3. Licence & Registration'), findsNothing);
    });

    testWidgets('documents are declared unattachable rather than checked', (tester) async {
      await tester.pumpWidget(host());
      await advanceTo(tester, 2);

      expect(find.textContaining('cannot be attached'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle_outline), findsNothing);
    });

    testWidgets('the payout step declares that no bank account is linked', (tester) async {
      await tester.pumpWidget(host());
      await advanceTo(tester, 3);

      expect(find.textContaining('No bank account is linked'), findsOneWidget);
    });
  });
}
