import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_registration_screen.dart';

void main() {
  group('RestaurantRegistrationScreen RM-007 Bank Settlement Tests', () {
    testWidgets('Navigation through onboarding to Step 4 (RM-007 Bank Settlement) succeeds', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 2000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(
        const MaterialApp(
          home: RestaurantRegistrationScreen(),
        ),
      );
      await tester.pumpAndSettle();

      // Step 1 -> Step 2
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();

      // Step 2 -> Step 3
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();

      // In Step 3 (RM-006): Verify and proceed
      expect(find.text('Legal & Food Safety Compliance'), findsOneWidget);
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();

      // Verify RM-007 UI Elements
      expect(find.text('Bank Account & Settlement Payouts'), findsOneWidget);
      expect(find.text('VERIFIED BUSINESS ENTITY'), findsOneWidget);
      expect(find.text('DESIGNATED COMMERCIAL BANK *'), findsOneWidget);
      expect(find.text('BANK ACCOUNT NUMBER *'), findsOneWidget);
      expect(find.text('RE-ENTER BANK ACCOUNT NUMBER *'), findsOneWidget);
      expect(find.text('Numbers Match'), findsOneWidget);
      expect(find.text('ROUTING & CLEARING CODE *'), findsOneWidget);
      expect(find.text('PAYOUT SETTLEMENT CADENCE'), findsOneWidget);
      expect(find.text('Daily T+1 Automated Settlement'), findsOneWidget);
      expect(find.text('Weekly Consolidated Settlement'), findsOneWidget);
      expect(find.text('CANCELLED CHEQUE / BANK PASSBOOK'), findsOneWidget);
      expect(find.text('cancelled_cheque_himalayan.png'), findsOneWidget);
      expect(find.text('Instant Penny-Drop Verification'), findsOneWidget);
      expect(find.text('Submit Application for Review'), findsOneWidget);
      expect(find.text('256-bit Bank Grade Encrypted Settlement Pipeline'), findsOneWidget);
    });

    testWidgets('Toggling account number visibility changes mask state', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 2000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(
        const MaterialApp(
          home: RestaurantRegistrationScreen(),
        ),
      );
      await tester.pumpAndSettle();

      // Advance directly to Step 4 (RM-007)
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();

      // Toggle mask icon button
      final visibilityBtn = find.byIcon(Icons.visibility);
      expect(visibilityBtn, findsOneWidget);
      await tester.tap(visibilityBtn);
      await tester.pumpAndSettle();

      // Now visibility off icon appears
      expect(find.byIcon(Icons.visibility_off), findsOneWidget);
    });
  });
}
