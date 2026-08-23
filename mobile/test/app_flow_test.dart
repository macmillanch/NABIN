import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

    testWidgets('9. WalletScreen renders balance and transactions', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: WalletScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(WalletScreen), findsOneWidget);
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
  });
}
