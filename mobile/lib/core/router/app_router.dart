import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/screens/welcome_screen.dart';
import '../../features/auth/presentation/screens/phone_entry_screen.dart';
import '../../features/auth/presentation/screens/otp_verification_screen.dart';
import '../../features/auth/presentation/screens/personalization_screen.dart';
import '../../features/auth/presentation/screens/identity_verification_submission_screen.dart';
import '../../features/auth/presentation/screens/identity_verification_status_screen.dart';
import '../../features/home/presentation/screens/customer_home_screen.dart';
import '../../features/ride/presentation/screens/ride_booking_screen.dart';
import '../../features/ride/presentation/screens/active_ride_screen.dart';
import '../../features/parcel/presentation/screens/parcel_booking_screen.dart';
import '../../features/food/presentation/screens/food_home_screen.dart';
import '../../features/food/presentation/screens/restaurant_menu_screen.dart';
import '../../features/food/presentation/screens/food_checkout_screen.dart';
import '../../features/food/presentation/screens/food_order_tracking_screen.dart';
import '../../features/grocery/presentation/screens/grocery_app_shell.dart';
import '../../features/grocery/presentation/screens/grocery_cart_screen.dart';
import '../../features/grocery/presentation/screens/grocery_checkout_screen.dart';
import '../../features/grocery/presentation/screens/grocery_categories_screen.dart';
import '../../features/grocery/presentation/screens/grocery_deals_screen.dart';
import '../../features/wallet/presentation/screens/wallet_screen.dart';
import '../../features/activity/presentation/screens/activity_screen.dart';
import '../../features/profile/presentation/screens/profile_screen.dart';
import '../../features/support/presentation/screens/customer_support_screen.dart';
import '../../features/driver/presentation/screens/driver_app_shell.dart';
import '../../features/restaurant/presentation/screens/restaurant_app_shell.dart';

import '../models/passenger_booking_info.dart';

final GoRouter appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    // 1. Auth & Onboarding Flow
    GoRoute(
      path: '/',
      builder: (context, state) => const WelcomeScreen(),
    ),
    GoRoute(
      path: '/phone-entry',
      builder: (context, state) => const PhoneEntryScreen(),
    ),
    GoRoute(
      path: '/otp-verification',
      builder: (context, state) {
        final phone = state.extra as String? ?? '9876543210';
        return OtpVerificationScreen(phoneNumber: phone);
      },
    ),
    GoRoute(
      path: '/personalization',
      builder: (context, state) => const PersonalizationScreen(),
    ),
    GoRoute(
      path: '/identity-verification-submit',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return IdentityVerificationSubmissionScreen(
          isResubmission: extra?['isResubmission'] as bool? ?? false,
          initialReason: extra?['reason'] as String?,
        );
      },
    ),
    GoRoute(
      path: '/identity-verification-status',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return IdentityVerificationStatusScreen(initialData: extra);
      },
    ),

    // 2. Customer Home
    GoRoute(
      path: '/home',
      builder: (context, state) => const CustomerHomeScreen(),
    ),

    // 3. NABIN Ride (2W, 3W, 4W)
    GoRoute(
      path: '/ride-booking',
      builder: (context, state) => const RideBookingScreen(),
    ),
    GoRoute(
      path: '/active-ride',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return ActiveRideScreen(
          vehicleType: extra?['vehicleType'] as String? ?? '3W',
          vehicleName: extra?['vehicleName'] as String? ?? 'Auto',
          fare: extra?['fare'] as String? ?? '₹85.00',
          passengerInfo: extra?['passengerInfo'] as PassengerBookingInfo?,
        );
      },
    ),

    // 4. NABIN Parcel
    GoRoute(
      path: '/parcel-booking',
      builder: (context, state) => const ParcelBookingScreen(),
    ),

    // 5. NABIN Food Delivery
    GoRoute(
      path: '/food-home',
      builder: (context, state) => const FoodHomeScreen(),
    ),
    GoRoute(
      path: '/restaurant-menu',
      builder: (context, state) => const RestaurantMenuScreen(),
    ),
    GoRoute(
      path: '/food-checkout',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return FoodCheckoutScreen(cartData: extra);
      },
    ),
    GoRoute(
      path: '/food-tracking',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return FoodOrderTrackingScreen(orderData: extra);
      },
    ),

    // 6. NABIN Grocery Express (10-Minute DarkStore)
    GoRoute(
      path: '/grocery-home',
      builder: (context, state) => const GroceryAppShell(),
    ),
    GoRoute(
      path: '/grocery-cart',
      builder: (context, state) => const GroceryCartScreen(),
    ),
    GoRoute(
      path: '/grocery-checkout',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        final cartItems = (extra?['cartItems'] as List?)?.cast<Map<String, dynamic>>() ?? [
          {'id': '1', 'name': 'Organic Alphonso Mangoes (1kg)', 'price': 240, 'quantity': 1},
        ];
        final subtotal = extra?['subtotal'] as int? ?? 240;
        final deliveryFee = extra?['deliveryFee'] as int? ?? 0;
        final handlingFee = extra?['handlingFee'] as int? ?? 2;
        return GroceryCheckoutScreen(
          cartItems: cartItems,
          subtotal: subtotal,
          deliveryFee: deliveryFee,
          handlingFee: handlingFee,
        );
      },
    ),
    GoRoute(
      path: '/grocery-categories',
      builder: (context, state) => GroceryCategoriesScreen(
        onAddToCart: (title) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Added "$title" to Cart!')),
          );
        },
      ),
    ),
    GoRoute(
      path: '/grocery-deals',
      builder: (context, state) => GroceryDealsScreen(
        onAddToCart: (title) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Added "$title" to Cart!')),
          );
        },
      ),
    ),

    // 7. Wallet & Fintech
    GoRoute(
      path: '/wallet',
      builder: (context, state) => const WalletScreen(),
    ),

    // 8. Activity History
    GoRoute(
      path: '/activity',
      builder: (context, state) => const ActivityScreen(),
    ),

    // 9. Profile & Security
    GoRoute(
      path: '/profile',
      builder: (context, state) => const ProfileScreen(),
    ),

    // 10. 24/7 Support & Disputes
    GoRoute(
      path: '/support',
      builder: (context, state) => const CustomerSupportScreen(),
    ),

    // 11. Partner Mode Simulators
    GoRoute(
      path: '/driver-dashboard',
      builder: (context, state) => const DriverAppShell(),
    ),
    GoRoute(
      path: '/restaurant-dashboard',
      builder: (context, state) => const RestaurantAppShell(),
    ),
  ],
);
