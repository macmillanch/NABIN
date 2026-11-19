import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_menu_tour_screen.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_menu_overview_screen.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_add_dish_screen.dart';
import 'package:mobile/features/restaurant/presentation/widgets/restaurant_menu_operations_sheet.dart';

void main() {
  group('Phase 4.3 Menu Management & Operations Widget Tests', () {
    testWidgets('RM-009: RestaurantMenuTourScreen renders feature tour cards and progresses', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: RestaurantMenuTourScreen()),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('RMS Tour (RM-009)'), findsOneWidget);
      expect(find.text('High-Tempo Live Order Stream'), findsOneWidget);
      expect(find.text('Never Miss an Order with Chime Audio Alerts'), findsOneWidget);
      expect(find.text('Next Feature'), findsOneWidget);

      await tester.tap(find.text('Next Feature'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Kitchen Display System (KDS)'), findsOneWidget);
      expect(find.text('Color-Coded Station Routing for Cook Staff'), findsOneWidget);
    });

    testWidgets('RM-026: RestaurantMenuOverviewScreen renders metrics, bento and catalog list', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(
        const MaterialApp(home: RestaurantMenuOverviewScreen()),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Menu Overview (RM-026)'), findsOneWidget);
      expect(find.text('Active Dishes'), findsOneWidget);
      expect(find.text('Live Categories'), findsOneWidget);
      expect(find.text('86\'d Out'), findsWidgets);
      expect(find.text('Menu Health & Analytics'), findsOneWidget);
      expect(find.text('Chicken Momo Special'), findsNWidgets(2)); // Star item + list item
      expect(find.text('Dishes Catalog (RM-028)'), findsOneWidget);
      expect(find.text('Add Dish (RM-029)'), findsOneWidget);
    });

    testWidgets('RM-029: RestaurantAddDishScreen validates and selects dietary tags', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(
        const MaterialApp(home: RestaurantAddDishScreen()),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Add New Dish (RM-029)'), findsOneWidget);
      expect(find.text('1. Basic Dish Details'), findsOneWidget);
      expect(find.text('Pure Veg'), findsOneWidget);
      expect(find.text('Non-Veg'), findsOneWidget);
      expect(find.text('Egg'), findsOneWidget);
      expect(find.text('Publish Dish to Menu'), findsOneWidget);

      await tester.tap(find.text('Pure Veg'));
      await tester.pump();

      await tester.tap(find.text('Publish Dish to Menu'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('RM-027: Menu Categories Management Modal renders categories and active switches', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () => RestaurantMenuOperationsSheet.showCategoriesSheet(context),
                child: const Text('Show Categories'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Show Categories'));
      await tester.pumpAndSettle();

      expect(find.text('Menu Categories (RM-027)'), findsOneWidget);
      expect(find.text('Momos & Tibetan Delicacies'), findsOneWidget);
      expect(find.text('Biryani & Pulao Bowls'), findsOneWidget);
      expect(find.text('Tandoori Kebabs & Breads'), findsOneWidget);
    });

    testWidgets('RM-031: Dish Customization Management Modal renders portion sizes and add-ons', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () => RestaurantMenuOperationsSheet.showCustomizationsSheet(context),
                child: const Text('Show Customizations'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Show Customizations'));
      await tester.pumpAndSettle();

      expect(find.text('Customizations (RM-031)'), findsOneWidget);
      expect(find.text('1. Portion Size (Required)'), findsOneWidget);
      expect(find.text('Half (6 pcs)'), findsOneWidget);
      expect(find.text('Full (10 pcs) - Default'), findsOneWidget);
      expect(find.text('2. Extra Chutney & Dips (Optional)'), findsOneWidget);
      expect(find.text('Fiery Timur Chili Dip'), findsOneWidget);
    });

    testWidgets('RM-032: Menu Availability & Scheduling Modal renders daypart shifts', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () => RestaurantMenuOperationsSheet.showMenuSchedulingSheet(context),
                child: const Text('Show Shifts'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Show Shifts'));
      await tester.pumpAndSettle();

      expect(find.text('Menu Shifts & Scheduling (RM-032)'), findsOneWidget);
      expect(find.text('Breakfast Express'), findsOneWidget);
      expect(find.text('Lunch Feast & Thalis'), findsOneWidget);
      expect(find.text('Dinner Line & Tandoor'), findsOneWidget);
      expect(find.text('LIVE NOW • Peak rush'), findsOneWidget);
    });

    testWidgets('RM-033: Bulk Menu Management Modal renders emergency staples and mass pricing', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () => RestaurantMenuOperationsSheet.showBulkMenuSheet(
                  context,
                  dishes: [
                    {'id': 'd1', 'name': 'Biryani', 'price': 300}
                  ],
                ),
                child: const Text('Show Bulk'),
              );
            },
          ),
        ),
      );

      await tester.tap(find.text('Show Bulk'));
      await tester.pumpAndSettle();

      expect(find.text('Bulk Operations (RM-033)'), findsOneWidget);
      expect(find.text('INSTANT 86\'D EMERGENCY STAPLES'), findsOneWidget);
      expect(find.text('Out of Paneer'), findsOneWidget);
      expect(find.text('Out of Biryani Rice'), findsOneWidget);
      expect(find.text('Tandoor Dough / LPG'), findsOneWidget);
      expect(find.text('+10% Holiday Markup'), findsOneWidget);
      expect(find.text('-10% Promo Discount'), findsOneWidget);
    });
  });
}
