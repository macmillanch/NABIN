import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_registration_screen.dart';

void main() {
  group('RestaurantRegistrationScreen RM-006 Compliance Document Tests', () {
    testWidgets('Renders Step 1 Business Details initially', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: RestaurantRegistrationScreen(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Restaurant & Owner Details'), findsOneWidget);
      expect(find.text('Entity Identity'), findsOneWidget);
      expect(find.text('Save & Continue'), findsOneWidget);
    });

    testWidgets('Navigation to Step 2 (Location) and Step 3 (RM-006 Compliance) succeeds', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: RestaurantRegistrationScreen(),
        ),
      );
      await tester.pumpAndSettle();

      // Tap Save & Continue to move to Step 2
      await tester.tap(find.text('Save & Continue'));
      await tester.pumpAndSettle();

      expect(find.text('Restaurant Location & Delivery Zone'), findsOneWidget);

      // Tap Save & Continue to move to Step 3 (RM-006)
      await tester.tap(find.text('Save & Continue'));
      await tester.pumpAndSettle();

      // Verify RM-006 UI elements
      expect(find.text('Legal & Food Safety Compliance'), findsOneWidget);
      expect(find.text('Food Safety & Standards'), findsOneWidget);
      expect(find.text('PAN / VAT Certificate'), findsOneWidget);
      expect(find.text('Restaurant Trade License'), findsOneWidget);
      expect(find.text('fssai_cert_2024.pdf'), findsOneWidget);
      expect(find.text('pan_vat_corporate_doc.jpg'), findsOneWidget);
      expect(find.text('Why is this required?'), findsOneWidget);
    });

    testWidgets('RM-006 Trade License upload changes state and displays filename', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.0;
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

      // Advance to Step 3
      await tester.tap(find.text('Save & Continue'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save & Continue'));
      await tester.pumpAndSettle();

      // Verify drop zone before upload
      final target = find.text('Tap to capture or upload license document');
      await tester.ensureVisible(target);
      await tester.pumpAndSettle();
      expect(target, findsOneWidget);

      // Tap upload area
      await tester.tap(target);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
      await tester.pumpAndSettle();

      // Verify uploaded state
      expect(find.text('Click to replace file'), findsOneWidget);
      expect(find.text('Attached'), findsNWidgets(2)); // FSSAI and Trade License both attached
    });
  });
}
