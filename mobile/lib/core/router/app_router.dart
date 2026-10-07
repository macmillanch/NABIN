import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/screens/welcome_screen.dart';
import '../../features/auth/presentation/screens/phone_entry_screen.dart';
import '../../features/auth/presentation/screens/otp_verification_screen.dart';
import '../../features/auth/presentation/screens/personalization_screen.dart';
import '../../features/auth/presentation/screens/identity_verification_submission_screen.dart';
import '../../features/auth/presentation/screens/identity_verification_status_screen.dart';
import '../../features/home/presentation/screens/customer_home_screen.dart';
import '../../features/home/presentation/screens/customer_splash_screen.dart';
import '../../features/ride/presentation/screens/ride_booking_screen.dart';
import '../../features/ride/presentation/screens/active_ride_screen.dart';
import '../../features/ride/presentation/screens/ride_receipt_screen.dart';
import '../../features/parcel/presentation/screens/parcel_booking_screen.dart';
import '../../features/parcel/presentation/screens/parcel_confirmation_screen.dart';
import '../../features/food/presentation/screens/food_home_screen.dart';
import '../../features/food/presentation/screens/food_category_screen.dart';
import '../../features/food/presentation/screens/dish_detail_screen.dart';
import '../../features/food/presentation/screens/restaurant_menu_screen.dart';
import '../../features/food/presentation/screens/food_checkout_screen.dart';
import '../../features/food/presentation/screens/food_order_tracking_screen.dart';
import '../../features/grocery/presentation/screens/grocery_app_shell.dart';
import '../../features/grocery/presentation/screens/grocery_cart_screen.dart';
import '../../features/grocery/presentation/providers/grocery_cart_provider.dart';
import '../../features/grocery/presentation/screens/grocery_checkout_screen.dart';
import '../../features/grocery/presentation/screens/grocery_order_status_screen.dart';
import '../../features/grocery/presentation/screens/grocery_categories_screen.dart';
import '../../features/grocery/presentation/screens/grocery_products_screen.dart';
import '../../features/grocery/presentation/screens/grocery_product_detail_screen.dart';
import '../../features/grocery/presentation/screens/grocery_deals_screen.dart';
import '../../features/wallet/presentation/screens/wallet_screen.dart';
import '../../features/activity/presentation/screens/activity_screen.dart';
import '../../features/profile/presentation/screens/profile_screen.dart';
import '../../features/support/presentation/screens/customer_support_screen.dart';
import '../../features/payment/presentation/screens/payment_screen.dart';
import '../../features/driver/presentation/screens/driver_app_shell.dart';
import '../../features/restaurant/presentation/screens/restaurant_app_shell.dart';

import '../config/nabin_build_env.dart';
import '../models/passenger_booking_info.dart';

/// The booking hands over `job['fare']`, which is a number (`mapRowToJob` parses it out of
/// `jobs.final_total`), while the ride screens take a display string. Casting `as String?`
/// threw a TypeError on the real path, and a raw `85` is not what a customer should read.
String _fareLabel(Object? raw) {
  if (raw == null) return '';
  if (raw is num) return '₹${raw.toStringAsFixed(2)}';
  final text = raw.toString();
  if (text.isEmpty) return '';
  final parsed = double.tryParse(text);
  return parsed == null ? text : '₹${parsed.toStringAsFixed(2)}';
}

final GoRouter appRouter = GoRouter(
  initialLocation: '/splash',
  routes: [
    // 0. Splash — routes by real session state (no timer, no loop)
    GoRoute(
      path: '/splash',
      builder: (context, state) => const CustomerSplashScreen(),
    ),

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
        final phone = state.extra as String? ??
            (NabinBuildEnv.allowsDemoConvenience ? '9876543210' : '');
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
      // No extra: this screen reads the application back from
      // `GET /api/identity/status/:userId` instead of being handed a map by the
      // screen before it, which is how it used to display a status nobody filed.
      builder: (context, state) => const IdentityVerificationStatusScreen(),
    ),

    // 2. Customer Home
    GoRoute(
      path: '/home',
      builder: (context, state) => const CustomerHomeScreen(),
    ),

    // 3. NABIN Ride (2W, 3W, 4W)
    GoRoute(
      path: '/ride-booking',
      builder: (context, state) {
        // Home's saved-place chips arrive through here. Dropping `extra` — which is
        // what this builder used to do — let a chip labelled with one child open a
        // ride defaulting to a different one.
        final extra = state.extra is Map
            ? Map<String, dynamic>.from(state.extra as Map)
            : const <String, dynamic>{};
        return RideBookingScreen(
          initialChildId: extra['childId'] as String?,
          initialSchoolId: extra['schoolId'] as String?,
        );
      },
    ),
    GoRoute(
      path: '/active-ride',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return ActiveRideScreen(
          vehicleType: extra?['vehicleType'] as String? ?? '3W',
          vehicleName: extra?['vehicleName'] as String? ?? 'Auto',
          fare: _fareLabel(extra?['fare']),
          passengerInfo: extra?['passengerInfo'] as PassengerBookingInfo?,
          // Without this the screen had no id to read, so it painted a lifecycle nobody
          // wrote: the booking handoff carried `jobId` but this builder dropped it.
          jobId: extra?['jobId'] as String?,
        );
      },
    ),

    // 3b. Ride receipt (from real TRIP_COMPLETED event + booking fields)
    GoRoute(
      path: '/ride-receipt',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return RideReceiptScreen(
          jobId: extra?['jobId'] as String?,
          fare: _fareLabel(extra?['fare']),
          vehicleType: (extra?['vehicleType'] as String?) ?? '3W',
          vehicleName: (extra?['vehicleName'] as String?) ?? 'Ride',
        );
      },
    ),

    // 4. NABIN Parcel
    GoRoute(
      path: '/parcel-booking',
      builder: (context, state) => const ParcelBookingScreen(),
    ),

    // 4b. Shared payment lifecycle (Ride / Food / Grocery / Parcel)
    GoRoute(
      path: '/payment',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return PaymentScreen(
          amount: extra?['amount'] as String? ?? '₹0',
          serviceName: extra?['serviceName'] as String? ?? 'NABIN',
          referenceId: extra?['referenceId'] as String? ?? 'NAB-0000',
          startStage:
              (extra?['startStage'] as PaymentStage?) ?? PaymentStage.method,
          authorize: extra?['authorize'] as Future<PaymentOutcome> Function()?,
        );
      },
    ),

    // 4b. Parcel booking confirmation (real job id + selected fare only)
    GoRoute(
      path: '/parcel-confirmation',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>?;
        return ParcelConfirmationScreen(
          jobId: extra?['jobId'] as String?,
          fare: (extra?['fare'] as String?) ?? '—',
        );
      },
    ),

    // 5. NABIN Food Delivery
    GoRoute(
      path: '/food-home',
      builder: (context, state) => const FoodHomeScreen(),
    ),
    GoRoute(
      path: '/food-categories',
      builder: (context, state) => const FoodCategoryScreen(),
    ),
    GoRoute(
      path: '/restaurant-menu',
      builder: (context, state) => const RestaurantMenuScreen(),
    ),
    GoRoute(
      path: '/dish-detail',
      builder: (context, state) => DishDetailScreen(
        restaurantId: state.uri.queryParameters['restaurantId'],
        dishId: state.uri.queryParameters['dishId'],
      ),
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
        // The live basket is the only source: there is no demo cart to fall back
        // to, and checkout needs the store the lines were stocked by.
        final cart =
            ProviderScope.containerOf(context).read(groceryCartProvider);
        return GroceryCheckoutScreen(
          cartItems: cart.checkoutLines,
          subtotal: cart.subtotalRupees,
        );
      },
    ),
    GoRoute(
      path: '/grocery-categories',
      builder: (context, state) => GroceryCategoriesScreen(
        // A home aisle tile names the aisle it shows, so the deep link selects
        // that aisle rather than opening the menu on whatever was last picked.
        initialCategory: state.uri.queryParameters['aisle'],
        onAddToCart: (title) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Added "$title" to Cart!')),
          );
        },
      ),
    ),
    GoRoute(
      path: '/grocery-products',
      builder: (context, state) => GroceryProductsScreen(
        initialCategory: state.uri.queryParameters['category'],
        initialSearch: state.uri.queryParameters['search'],
      ),
    ),
    GoRoute(
      path: '/grocery-product-detail',
      builder: (context, state) => GroceryProductDetailScreen(
        productId: state.uri.queryParameters['productId'],
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
    GoRoute(
      path: '/grocery-tracking',
      builder: (context, state) {
        // Checkout hands over the order row it just placed; the screen reads the
        // rest back from the platform, so only the id travels through the router.
        final extra = state.extra as Map<String, dynamic>?;
        return GroceryOrderStatusScreen(orderData: extra);
      },
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

    // 11. Partner Mode Simulators.
    //
    // These two shells are stand-ins for the Driver and Restaurant consoles, painted from
    // literals written into the widgets — a sample driver's name, rating and earnings, a
    // sample restaurant's orders. They are demo surfaces, not the partner apps, and they
    // are registered only for a build that is not addressed at a real user: a customer on
    // a production build has no route here to be misled by, and a deep link to one of
    // these locations lands on "no route found", which is the truth.
    if (NabinBuildEnv.allowsDemoConvenience) ...[
      GoRoute(
        path: '/driver-dashboard',
        builder: (context, state) => const DriverAppShell(),
      ),
      GoRoute(
        path: '/restaurant-dashboard',
        builder: (context, state) => const RestaurantAppShell(),
      ),
    ],
  ],
);
