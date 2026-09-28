import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/presentation/screens/driver_otp_screen.dart';

/// A regression lock on the driver login screen.
///
/// This screen used to log anybody in. Its code field arrived pre-filled with `7729`, a label
/// printed "Demo code: 7729" on the shipping UI, the resend control was `onPressed: () {}`,
/// and pressing Verify performed no request at all — it waited 600 ms and navigated to the
/// driver console. A partner did not need credentials to reach a screen that shows earnings
/// and starts trips.
///
/// These assertions need no network: they are about what the device puts on screen before the
/// platform has said anything, which is exactly where the defect lived.
void main() {
  Widget host(Widget child) => MaterialApp(
        home: Scaffold(body: child),
      );

  testWidgets('the OTP field is never pre-filled with a code', (tester) async {
    await tester.pumpWidget(host(const DriverOtpScreen(phoneNumber: '9810122910')));

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, isEmpty,
        reason: 'a code typed into the field is not this partner\'s code');
  });

  testWidgets('no demo or fixed OTP is ever shown as text', (tester) async {
    await tester.pumpWidget(host(const DriverOtpScreen(phoneNumber: '9810122910')));

    expect(find.textContaining('Demo code'), findsNothing);
    expect(find.textContaining('7729'), findsNothing);
    expect(find.textContaining('4892'), findsNothing);
    expect(find.textContaining('3184'), findsNothing);
  });

  testWidgets('the number being verified is the one the login step asked for', (tester) async {
    await tester.pumpWidget(host(const DriverOtpScreen(phoneNumber: '9810122910')));

    expect(find.textContaining('9810122910'), findsOneWidget);
    // The login screen used to hand this screen a stand-in number of its own.
    expect(find.textContaining('9876543210'), findsNothing);
  });

  testWidgets('verify refuses an incomplete code without contacting the platform', (tester) async {
    await tester.pumpWidget(host(const DriverOtpScreen(phoneNumber: '9810122910')));

    await tester.tap(find.textContaining('Verify'));
    await tester.pump();

    expect(find.textContaining('complete 4-digit OTP'), findsOneWidget);
  });
}
