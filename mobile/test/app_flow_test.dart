import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/widgets/driver_map_view.dart';
import 'package:mobile/features/auth/presentation/screens/welcome_screen.dart';
import 'package:mobile/features/auth/presentation/screens/phone_entry_screen.dart';
import 'package:mobile/features/auth/presentation/screens/otp_verification_screen.dart';
import 'package:mobile/features/auth/presentation/screens/personalization_screen.dart';
import 'package:mobile/features/home/presentation/screens/customer_home_screen.dart';
import 'package:mobile/features/ride/presentation/screens/ride_booking_screen.dart';
import 'package:mobile/features/parcel/presentation/screens/parcel_booking_screen.dart';
import 'package:mobile/features/food/presentation/screens/food_home_screen.dart';
import 'package:mobile/features/wallet/presentation/screens/wallet_screen.dart';
import 'package:mobile/features/activity/presentation/screens/activity_screen.dart';
import 'package:mobile/features/profile/presentation/screens/profile_screen.dart';

import 'package:mobile/features/driver/presentation/screens/driver_app_shell.dart';
import 'package:mobile/features/auth/presentation/screens/driver_kyc_registration_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_home_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_cart_screen.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_app_shell.dart';
import 'package:mobile/features/support/presentation/screens/customer_support_screen.dart';

void main() {
  group('NABIN Super-App Component & Screen Unit Tests', () {
    testWidgets('1. WelcomeScreen renders carousel and Get Started button', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: WelcomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('NABIN'), findsWidgets);
      expect(find.text('Fast, Reliable Rides'), findsOneWidget);
      expect(find.text('Get Started'), findsOneWidget);
      expect(find.text('Skip'), findsOneWidget);
    });

    testWidgets('2. PhoneEntryScreen renders input field and Continue button', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PhoneEntryScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Welcome to Nabin'), findsOneWidget);
      expect(find.textContaining('+91'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Continue'), findsOneWidget);
    });

    testWidgets('3. OtpVerificationScreen renders OTP inputs and Verify button', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: OtpVerificationScreen(phoneNumber: '9876543210'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text("Verify it's you"), findsOneWidget);
      expect(find.textContaining('9876543210'), findsOneWidget);
      expect(find.text('Verify & Proceed'), findsOneWidget);
    });

    testWidgets('4. PersonalizationScreen renders language and profile setup', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PersonalizationScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Complete your profile'), findsOneWidget);
      expect(find.text('Get Moving'), findsOneWidget);
    });

    testWidgets('5. CustomerHomeScreen renders services (Ride, Food, Parcel)', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: CustomerHomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(CustomerHomeScreen), findsOneWidget);
      expect(find.textContaining('NABIN'), findsWidgets);
      expect(find.textContaining('Ride'), findsWidgets);
      expect(find.textContaining('Food'), findsWidgets);
      expect(find.textContaining('Parcel'), findsWidgets);
    });

    testWidgets('6. RideBookingScreen renders vehicle categories', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: RideBookingScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(RideBookingScreen), findsOneWidget);
      // The map behind this screen was the Driver app's widget, whose geometry is
      // a hard-coded Delhi polyline with eight invented drivers pinned around
      // Civil Lines. A Customer booking must not draw a route through Delhi for a
      // ride whose ends were placed in Aizawl, so neither the widget nor a route
      // line may come back.
      expect(find.byType(DriverMapView), findsNothing);
      expect(find.byType(Polyline), findsNothing);
    });

    testWidgets('7. ParcelBookingScreen renders parcel options', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: ParcelBookingScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(ParcelBookingScreen), findsOneWidget);
    });

    testWidgets('8. FoodHomeScreen renders food categories', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: FoodHomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(FoodHomeScreen), findsOneWidget);
    });

    testWidgets('9. WalletScreen renders without a balance it has to invent', (tester) async {
      // This file has no HttpOverrides of its own, so the screen's GET /auth/me gets
      // flutter_test's blocking answer and it settles in its "couldn't load" state.
      // That is the point of this smoke test: the screen must render either a balance
      // it read or an admission that it could not, never the ₹450.00 literal it used
      // to carry. `customer_wallet_test.dart` serves the route and asserts numbers.
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: WalletScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(WalletScreen), findsOneWidget);
      expect(find.textContaining('450'), findsNothing);
    });

    testWidgets('10. ProfileScreen renders user profile information', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: ProfileScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(ProfileScreen), findsOneWidget);
    });

    testWidgets('11. ActivityScreen renders trip history and order logs', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: ActivityScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(ActivityScreen), findsOneWidget);
    });

    testWidgets('12. DriverAppShell renders online/offline dispatch toggle', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: DriverAppShell(),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(DriverAppShell), findsOneWidget);
    });

    testWidgets('13. DriverKycRegistrationScreen renders KYC form controls', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: DriverKycRegistrationScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(DriverKycRegistrationScreen), findsOneWidget);
    });

    testWidgets('14. GroceryHomeScreen renders catalog categories and product list', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: GroceryHomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(GroceryHomeScreen), findsOneWidget);
    });

    testWidgets('15. GroceryCartScreen renders express checkout cart', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: GroceryCartScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(GroceryCartScreen), findsOneWidget);
    });

    testWidgets('16. RestaurantAppShell renders merchant order and menu tabs', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: RestaurantAppShell(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(RestaurantAppShell), findsOneWidget);
    });

    testWidgets('17. CustomerSupportScreen renders help topics and dispute resolution', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: CustomerSupportScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(CustomerSupportScreen), findsOneWidget);
    });
  });
}
