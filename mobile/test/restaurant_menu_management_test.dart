import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/theme/restaurant_theme.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_menu_management_screen.dart';

Widget testBoilerplate(Widget child) {
  return MaterialApp(
    theme: ThemeData(
      primaryColor: RestaurantTheme.neonOrange,
      scaffoldBackgroundColor: const Color(0xFFF8F9FA),
    ),
    home: child,
  );
}

void main() {
  group('RestaurantMenuManagementScreen Tests', () {
    testWidgets('RMM-01: Screen renders title, search bar, and Add Dish button', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      expect(find.text('Restaurant Menu Studio'), findsOneWidget);
      expect(find.text('Add Dish'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('All'), findsWidgets);
      expect(find.text('Main Course'), findsWidgets);
    });

    testWidgets('RMM-02: Default dishes render with prices, categories and prep times', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      expect(find.text('Royal Mutton Dum Biryani'), findsOneWidget);
      expect(find.text('Paneer Butter Masala'), findsOneWidget);
      expect(find.text('₹340'), findsOneWidget);
      expect(find.text('₹260'), findsOneWidget);
      expect(find.text('30 min'), findsOneWidget);
      expect(find.text('20 min'), findsOneWidget);
    });

    testWidgets('RMM-03: Filtering by category filters visible dishes', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      // Search for 'Paneer'
      await tester.enterText(find.byType(TextField), 'Paneer');
      await tester.pumpAndSettle();

      expect(find.text('Paneer Butter Masala'), findsOneWidget);
      expect(find.text('Royal Mutton Dum Biryani'), findsNothing);
    });

    testWidgets('RMM-04: Sizing variants and Add-on group tags are displayed', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      expect(find.text('3 Sizes/Variants'), findsOneWidget);
      expect(find.text('1 Add-on Groups'), findsWidgets);
    });

    testWidgets('RMM-05: Tapping Preview opens Customer-Facing Preview sheet', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      // Tap Preview button on first dish
      final previewButtons = find.text('Preview');
      expect(previewButtons, findsWidgets);
      await tester.tap(previewButtons.first);
      await tester.pumpAndSettle();

      expect(find.text('Customer-Facing Preview'), findsOneWidget);
      expect(find.text('CHOOSE PORTION / SIZE'), findsOneWidget);
    });

    testWidgets('RMM-06: Add Dish form validates required name and selling price > 0', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add Dish'));
      await tester.pumpAndSettle();

      expect(find.text('Add New Dish'), findsOneWidget);

      // Attempt save with empty dish name
      await tester.tap(find.text('Save Dish'));
      await tester.pumpAndSettle();

      expect(find.text('Please enter a dish name.'), findsOneWidget);

      // Enter name, set price to 0
      await tester.enterText(find.widgetWithText(TextField, 'Dish Name *'), 'Test Curry');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '0');

      await tester.tap(find.text('Save Dish'));
      await tester.pumpAndSettle();

      expect(find.text('Please enter a valid selling price greater than 0.'), findsOneWidget);
    });

    testWidgets('RMM-07: Add Dish creates new dish in catalog with price and category', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add Dish'));
      await tester.pumpAndSettle();

      await tester.enterText(find.widgetWithText(TextField, 'Dish Name *'), 'Crispy Corn Salt & Pepper');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '190');

      await tester.tap(find.text('Save Dish'));
      await tester.pumpAndSettle();

      expect(find.text('Crispy Corn Salt & Pepper'), findsOneWidget);
      expect(find.text('₹190'), findsOneWidget);
    });

    testWidgets('RMM-08: Edit Dish updates dish details without creating duplicate', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      // Tap Edit on Royal Mutton Dum Biryani (first dish)
      final editButtons = find.byIcon(Icons.edit_outlined);
      expect(editButtons, findsWidgets);
      await tester.tap(editButtons.first);
      await tester.pumpAndSettle();

      expect(find.text('Edit Dish'), findsOneWidget);

      await tester.enterText(find.widgetWithText(TextField, 'Dish Name *'), 'Royal Mutton Biryani Special');
      await tester.tap(find.text('Save Dish'));
      await tester.pumpAndSettle();

      expect(find.text('Royal Mutton Biryani Special'), findsOneWidget);
      expect(find.text('Royal Mutton Dum Biryani'), findsNothing);
    });

    testWidgets('RMM-09: Unsaved-changes protection prompts confirmation dialog on Cancel', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add Dish'));
      await tester.pumpAndSettle();

      // Modify form to make it dirty
      await tester.enterText(find.widgetWithText(TextField, 'Dish Name *'), 'Draft Dish in Progress');

      // Tap Cancel
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(find.text('Discard Unsaved Changes?'), findsOneWidget);

      // Tap Keep Editing
      await tester.tap(find.text('Keep Editing'));
      await tester.pumpAndSettle();

      expect(find.text('Add New Dish'), findsOneWidget);

      // Tap Cancel again, this time Discard
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Discard'));
      await tester.pumpAndSettle();

      expect(find.text('Add New Dish'), findsNothing);
      expect(find.text('Draft Dish in Progress'), findsNothing);
    });

    testWidgets('RMM-10: Photo selection allows choosing from curated gallery and sets primary photo', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add Dish'));
      await tester.pumpAndSettle();

      // Scroll to Add Photo button inside sheet
      await tester.scrollUntilVisible(find.text('Add Photo'), 100, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Add Photo'));
      await tester.pumpAndSettle();

      expect(find.text('Add Dish Photo URL'), findsOneWidget);
      expect(find.text('Curated demo food photos:'), findsOneWidget);

      // Tap first curated demo food photo inside AlertDialog
      final dialogInkWell = find.descendant(of: find.byType(AlertDialog), matching: find.byType(InkWell)).first;
      await tester.tap(dialogInkWell);
      await tester.pumpAndSettle();

      await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Add Photo')));
      await tester.pumpAndSettle();

      expect(find.text('Add Dish Photo URL'), findsNothing);
      expect(find.text('Primary'), findsOneWidget);
    });

    testWidgets('RMM-11: Variant creation adds portion sizes and updates pricing', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add Dish'));
      await tester.pumpAndSettle();

      // Scroll to Add Size button
      await tester.scrollUntilVisible(find.text('Add Size'), 100, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Add Size'));
      await tester.pumpAndSettle();

      expect(find.text('New Size'), findsOneWidget);
    });

    testWidgets('RMM-12: Add-on group creation configures customization options', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add Dish'));
      await tester.pumpAndSettle();

      // Scroll to Add Group button
      await tester.scrollUntilVisible(find.text('Add Group'), 100, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Add Group'));
      await tester.pumpAndSettle();

      expect(find.text('New Add-on Group'), findsOneWidget);
      expect(find.text('Required Group'), findsOneWidget);
      expect(find.text('Option 1'), findsOneWidget);
    });

    testWidgets('RMM-13: Customer-Facing Preview dynamically calculates total with variant, add-on, and quantity', (tester) async {
      await tester.pumpWidget(testBoilerplate(const RestaurantMenuManagementScreen()));
      await tester.pumpAndSettle();

      // Tap Preview on Royal Mutton Dum Biryani (first dish, ₹340 base for Half)
      final previewButtons = find.text('Preview');
      await tester.tap(previewButtons.first);
      await tester.pumpAndSettle();

      expect(find.text('Customer-Facing Preview'), findsOneWidget);
      expect(find.text('₹340'), findsWidgets);

      // Select 'Full (Serves 2, 2 Shanks)' (₹580)
      await tester.scrollUntilVisible(find.text('Full (Serves 2, 2 Shanks)'), 100, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Full (Serves 2, 2 Shanks)'));
      await tester.pumpAndSettle();

      expect(find.text('₹580'), findsWidgets);

      // Select add-on 'Special Mirchi Ka Salan (150ml)' (+₹40 -> ₹620)
      await tester.scrollUntilVisible(find.text('Special Mirchi Ka Salan (150ml)'), 100, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Special Mirchi Ka Salan (150ml)'));
      await tester.pumpAndSettle();

      expect(find.text('₹620'), findsOneWidget);

      // Increase quantity to 2 (2 x 620 = 1240)
      await tester.tap(find.byIcon(Icons.add).last);
      await tester.pumpAndSettle();

      expect(find.text('₹1240'), findsOneWidget);

      // Tap Item Valid button to verify preview confirmation
      await tester.tap(find.text('Item Valid'));
      await tester.pumpAndSettle();

      expect(find.text('Preview Verified: 2 x Royal Mutton Dum Biryani totaling ₹1240'), findsOneWidget);
    });
  });
}
