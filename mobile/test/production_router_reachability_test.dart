import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/home/presentation/screens/customer_home_screen.dart';
import 'package:mobile/features/home/presentation/screens/customer_splash_screen.dart';
import 'package:mobile/features/ride/presentation/screens/ride_booking_screen.dart';
import 'package:mobile/features/ride/presentation/screens/active_ride_screen.dart';
import 'package:mobile/features/ride/presentation/screens/ride_receipt_screen.dart';
import 'package:mobile/features/food/presentation/screens/food_home_screen.dart';
import 'package:mobile/features/food/presentation/screens/food_category_screen.dart';
import 'package:mobile/features/food/presentation/screens/restaurant_menu_screen.dart';
import 'package:mobile/features/food/presentation/screens/dish_detail_screen.dart';
import 'package:mobile/features/parcel/presentation/screens/parcel_booking_screen.dart';
import 'package:mobile/features/parcel/presentation/screens/parcel_confirmation_screen.dart';
import 'package:mobile/features/payment/presentation/screens/payment_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_app_shell.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_categories_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_products_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_deals_screen.dart';
import 'package:mobile/features/wallet/presentation/screens/wallet_screen.dart';
import 'package:mobile/features/activity/presentation/screens/activity_screen.dart';
import 'package:mobile/features/profile/presentation/screens/profile_screen.dart';
import 'package:mobile/features/support/presentation/screens/customer_support_screen.dart';

Widget testRouterApp(String initialLocation) {
  appRouter.go(initialLocation);
  return ProviderScope(
    child: MaterialApp.router(
      routerConfig: appRouter,
    ),
  );
}

void main() {
  group('NABIN Production AppRouter Real Reachability Tests', () {
    testWidgets('production router reaches /splash directly', (tester) async {
      await tester.pumpWidget(testRouterApp('/splash'));
      await tester.pump();
      expect(find.byType(CustomerSplashScreen), findsOneWidget);
    });

    testWidgets('production router reaches /home', (tester) async {
      await tester.pumpWidget(testRouterApp('/home'));
      await tester.pumpAndSettle();
      expect(find.byType(CustomerHomeScreen), findsOneWidget);
    });

    testWidgets('production router reaches /ride-booking', (tester) async {
      await tester.pumpWidget(testRouterApp('/ride-booking'));
      await tester.pumpAndSettle();
      expect(find.byType(RideBookingScreen), findsOneWidget);
    });

    testWidgets('production router reaches /active-ride with state arguments', (tester) async {
      appRouter.go('/active-ride', extra: {
        'jobId': 'JOB-RIDE-01',
        'fare': 120.0,
        'vehicleType': '3W',
        'vehicleName': 'Auto',
      });
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: appRouter),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(ActiveRideScreen), findsOneWidget);
    });

    testWidgets('production router reaches /ride-receipt with state arguments', (tester) async {
      appRouter.go('/ride-receipt', extra: {
        'jobId': 'JOB-RIDE-01',
        'fare': 120.0,
        'vehicleType': '3W',
        'vehicleName': 'Auto',
      });
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: appRouter),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(RideReceiptScreen), findsOneWidget);
    });

    testWidgets('production router reaches /parcel-booking', (tester) async {
      await tester.pumpWidget(testRouterApp('/parcel-booking'));
      await tester.pumpAndSettle();
      expect(find.byType(ParcelBookingScreen), findsOneWidget);
    });

    testWidgets('production router reaches /parcel-confirmation with extra', (tester) async {
      appRouter.go('/parcel-confirmation', extra: {
        'jobId': 'JOB-PARCEL-101',
        'fare': '₹85',
      });
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: appRouter),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(ParcelConfirmationScreen), findsOneWidget);
    });

    testWidgets('production router reaches /payment with extra', (tester) async {
      appRouter.go('/payment', extra: {
        'amount': '₹249',
        'serviceName': 'Food Delivery',
        'referenceId': 'ORD-FOOD-8821',
      });
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(routerConfig: appRouter),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PaymentScreen), findsOneWidget);
    });

    testWidgets('production router reaches /food-home and /food-categories', (tester) async {
      await tester.pumpWidget(testRouterApp('/food-home'));
      await tester.pumpAndSettle();
      expect(find.byType(FoodHomeScreen), findsOneWidget);

      appRouter.go('/food-categories');
      await tester.pumpAndSettle();
      expect(find.byType(FoodCategoryScreen), findsOneWidget);

      appRouter.go('/restaurant-menu');
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantMenuScreen), findsOneWidget);
    });

    testWidgets('production router reaches /dish-detail via query parameters', (tester) async {
      await tester.pumpWidget(testRouterApp('/dish-detail?restaurantId=rest-01&dishId=dish-01'));
      await tester.pumpAndSettle();
      expect(find.byType(DishDetailScreen), findsOneWidget);
    });

    testWidgets('production router reaches /grocery-home and aisles', (tester) async {
      await tester.pumpWidget(testRouterApp('/grocery-home'));
      await tester.pumpAndSettle();
      expect(find.byType(GroceryAppShell), findsOneWidget);

      appRouter.go('/grocery-categories');
      await tester.pumpAndSettle();
      expect(find.byType(GroceryCategoriesScreen), findsOneWidget);

      appRouter.go('/grocery-products');
      await tester.pumpAndSettle();
      expect(find.byType(GroceryProductsScreen), findsOneWidget);

      appRouter.go('/grocery-deals');
      await tester.pumpAndSettle();
      expect(find.byType(GroceryDealsScreen), findsOneWidget);
    });

    testWidgets('production router reaches /wallet, /activity, /profile, /support', (tester) async {
      await tester.pumpWidget(testRouterApp('/wallet'));
      await tester.pumpAndSettle();
      expect(find.byType(WalletScreen), findsOneWidget);

      appRouter.go('/activity');
      await tester.pumpAndSettle();
      expect(find.byType(ActivityScreen), findsOneWidget);

      appRouter.go('/profile');
      await tester.pumpAndSettle();
      expect(find.byType(ProfileScreen), findsOneWidget);

      appRouter.go('/support');
      await tester.pumpAndSettle();
      expect(find.byType(CustomerSupportScreen), findsOneWidget);
    });
  });
}
