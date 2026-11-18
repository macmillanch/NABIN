import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/restaurant/presentation/widgets/restaurant_operations_sheet.dart';

void main() {
  group('RestaurantOperationsSheet Phase 4.2 Operations Tests', () {
    testWidgets('RM-012: Incoming Order Alert Overlay renders and fires callbacks', (WidgetTester tester) async {
      int? acceptedMins;
      String? rejectedReason;

      final testOrder = {
        'id': 'ord_test_1',
        'number': 'NB-4825',
        'customerName': 'Aarav Sharma',
        'totalAmount': 540.0,
        'lines': [
          {'name': 'Butter Chicken', 'quantity': 1},
          {'name': 'Garlic Naan', 'quantity': 2},
        ]
      };

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  RestaurantOperationsSheet.showIncomingOrderAlert(
                    context,
                    testOrder,
                    onAccept: (m) => acceptedMins = m,
                    onReject: (r) => rejectedReason = r,
                  );
                },
                child: const Text('Show Alert'),
              );
            },
          ),
        ),
      );

      // Trigger Alert
      await tester.tap(find.text('Show Alert'));
      await tester.pumpAndSettle();

      expect(find.text('INCOMING ORDER CHIME'), findsOneWidget);
      expect(find.text('NB-4825 • ₹540.0'), findsOneWidget);
      expect(find.text('Customer: Aarav Sharma'), findsOneWidget);
      expect(find.text('1x Butter Chicken'), findsOneWidget);

      // Tap Accept
      await tester.tap(find.text('Accept (25m)'));
      await tester.pumpAndSettle();

      expect(acceptedMins, 25);
    });

    testWidgets('RM-014: Accept Order Dialog renders prep time chips', (WidgetTester tester) async {
      int? selectedMins;

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  RestaurantOperationsSheet.showAcceptOrderDialog(
                    context,
                    {'number': 'NB-4825'},
                    onConfirm: (m) => selectedMins = m,
                  );
                },
                child: const Text('Accept Dialog'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Accept Dialog'));
      await tester.pumpAndSettle();

      expect(find.text('Accept Order & Estimate Prep Time'), findsOneWidget);
      expect(find.text('15 mins'), findsOneWidget);
      expect(find.text('25 mins'), findsOneWidget);
      expect(find.text('35 mins'), findsOneWidget);

      await tester.tap(find.text('35 mins'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Confirm & Start Prep'));
      await tester.pumpAndSettle();

      expect(selectedMins, 35);
    });

    testWidgets('RM-015: Reject Order Dialog requires structured reason', (WidgetTester tester) async {
      String? rejectedReason;

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  RestaurantOperationsSheet.showRejectOrderDialog(
                    context,
                    {'number': 'NB-4825'},
                    onConfirm: (r, n) => rejectedReason = r,
                  );
                },
                child: const Text('Reject Dialog'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Reject Dialog'));
      await tester.pumpAndSettle();

      expect(find.text('Reject Order'), findsOneWidget);
      expect(find.text('Item out of stock / 86ed'), findsOneWidget);
      expect(find.text('Kitchen closed for rush hour'), findsOneWidget);

      await tester.tap(find.text('Kitchen closed for rush hour'));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(ElevatedButton, 'Confirm Rejection'));
      await tester.pumpAndSettle();

      expect(rejectedReason, 'MERCHANT_CLOSED');
    });

    testWidgets('RM-024: Kitchen Station Management Dialog renders stations', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  RestaurantOperationsSheet.showKitchenStationsDialog(context);
                },
                child: const Text('Stations Dialog'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Stations Dialog'));
      await tester.pumpAndSettle();

      expect(find.text('Kitchen Station Routing (RM-024)'), findsOneWidget);
      expect(find.text('Grill & Tandoor Station'), findsOneWidget);
      expect(find.text('Main Curry & Rice Station'), findsOneWidget);
      expect(find.text('Expediter & Bagging Bay'), findsOneWidget);
    });

    testWidgets('RM-025: KDS Display Settings Dialog allows column and chime selection', (WidgetTester tester) async {
      Map<String, dynamic>? saved;

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  RestaurantOperationsSheet.showKdsSettingsDialog(
                    context,
                    onSaved: (s) => saved = s,
                  );
                },
                child: const Text('KDS Settings'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('KDS Settings'));
      await tester.pumpAndSettle();

      expect(find.text('KDS Display Settings (RM-025)'), findsOneWidget);
      expect(find.text('2 Columns'), findsOneWidget);
      expect(find.text('3 Columns'), findsOneWidget);
      expect(find.text('4 Columns'), findsOneWidget);

      await tester.tap(find.text('4 Columns'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save Settings'));
      await tester.pumpAndSettle();

      expect(saved?['gridColumns'], 4);
    });

    testWidgets('RM-017 / RM-019: Customer Disputes Sheet renders claims and evidence', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  RestaurantOperationsSheet.showDisputesSheet(context);
                },
                child: const Text('Disputes Sheet'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Disputes Sheet'));
      await tester.pumpAndSettle();

      expect(find.text('Customer Order Disputes (RM-017)'), findsOneWidget);
      expect(find.text('NB-DISP-4825 (NB-4825)'), findsOneWidget);
      expect(find.text('Issue: Missing Garlic Naan (2 pcs)'), findsOneWidget);
      expect(find.text('Approve Refund'), findsOneWidget);
    });
  });
}
