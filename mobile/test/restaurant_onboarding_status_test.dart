import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_onboarding_status_screen.dart';

void main() {
  group('RestaurantOnboardingStatusScreen RM-008 Tests', () {
    testWidgets('Renders all canonical Stitch RM-008 UI sections', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(
        const MaterialApp(
          home: RestaurantOnboardingStatusScreen(),
        ),
      );
      // Pump initial frames
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      // 1. Hero Banner
      expect(find.text('Fast-Track Verification'), findsOneWidget);
      expect(find.text('Application In Review'), findsOneWidget);
      expect(find.text('OVERALL COMPLETION'), findsOneWidget);

      // 2. Compliance Pipeline Stepper
      expect(find.text('Compliance Pipeline'), findsOneWidget);
      expect(find.text('4-tier verification protocol'), findsOneWidget);
      expect(find.text('Business Profile & Contact'), findsOneWidget);
      expect(find.text('Store Geolocation & Pin'), findsOneWidget);
      expect(find.text('Food Safety & PAN Docs'), findsOneWidget);
      expect(find.text('Bank Account Settlement'), findsOneWidget);
      expect(find.text('Document Officer: Sarah K. (Compliance Desk)'), findsOneWidget);

      // 3. Fast-Track Setup Shortcuts
      expect(find.text('Fast-Track Setup'), findsOneWidget);
      expect(find.text('Explore Sample Menu Setup'), findsOneWidget);
      expect(find.text('Pair Thermal Receipt Printer'), findsOneWidget);
      expect(find.text('Kitchen Staff Training Guide'), findsOneWidget);

      // 4. Support Concierge
      expect(find.text('Need faster review?'), findsOneWidget);
      expect(find.text('Start Live Chat (24/7)'), findsOneWidget);

      // 5. Primary Action
      expect(find.text('Go to Partner Dashboard Preview'), findsOneWidget);
      expect(find.text('Live order dispatching activates immediately upon FSSAI document clearance.'), findsOneWidget);
    });

    testWidgets('Live Chat button triggers concierge feedback', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(
        const MaterialApp(
          home: RestaurantOnboardingStatusScreen(),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      final chatBtn = find.text('Start Live Chat (24/7)');
      await tester.ensureVisible(chatBtn);
      await tester.tap(chatBtn);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Starting live compliance chat session...'), findsOneWidget);
    });
  });
}
