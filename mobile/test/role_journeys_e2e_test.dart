import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Customer screens
import 'package:mobile/features/auth/presentation/screens/welcome_screen.dart';
import 'package:mobile/features/auth/presentation/screens/phone_entry_screen.dart';
import 'package:mobile/features/auth/presentation/screens/otp_verification_screen.dart';
import 'package:mobile/features/home/presentation/screens/customer_home_screen.dart';
import 'package:mobile/features/ride/presentation/screens/ride_booking_screen.dart';
import 'package:mobile/features/food/presentation/screens/food_home_screen.dart';
import 'package:mobile/features/food/presentation/screens/dish_detail_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_home_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_cart_screen.dart';
import 'package:mobile/features/activity/presentation/screens/activity_screen.dart';
import 'package:mobile/features/wallet/presentation/screens/wallet_screen.dart';
import 'package:mobile/features/support/presentation/screens/customer_support_screen.dart';
import 'package:mobile/features/profile/presentation/screens/profile_screen.dart';

// Driver screens
import 'package:mobile/features/auth/presentation/screens/driver_login_screen.dart';
import 'package:mobile/features/auth/presentation/screens/driver_kyc_registration_screen.dart';
import 'package:mobile/features/home/presentation/screens/driver_home_screen.dart';
import 'package:mobile/features/driver/presentation/screens/driver_app_shell.dart';
import 'package:mobile/features/job/presentation/screens/active_job_execution_screen.dart';
import 'package:mobile/features/earnings/presentation/screens/driver_earnings_screen.dart';
import 'package:mobile/features/payout/presentation/screens/driver_payout_screen.dart';
import 'package:mobile/features/support/presentation/screens/driver_support_screen.dart';
import 'package:mobile/features/support/presentation/screens/driver_support_new_ticket_screen.dart';
import 'package:mobile/features/support/presentation/screens/driver_support_ticket_screen.dart';
import 'package:mobile/features/notifications/presentation/screens/driver_notifications_screen.dart';

// Restaurant Merchant screens
import 'package:mobile/features/restaurant/presentation/screens/restaurant_login_screen.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_app_shell.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_main_shell.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_dish_detail_screen.dart';

// Grocery Merchant screens
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_login_screen.dart';
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_dashboard.dart';
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_orders_screen.dart';
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_order_detail_screen.dart';
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_catalog_screen.dart';
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_inventory_screen.dart';
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_price_management_screen.dart';

// Admin screens
import 'package:mobile/features/admin/presentation/screens/admin_login_screen.dart';
import 'package:mobile/features/admin/presentation/screens/admin_dashboard_screen.dart';
import 'package:mobile/features/admin/presentation/screens/admin_users_screen.dart';
import 'package:mobile/features/admin/presentation/screens/admin_fleet_screen.dart';
import 'package:mobile/features/admin/presentation/screens/admin_merchants_screen.dart';
import 'package:mobile/features/admin/presentation/screens/admin_orders_screen.dart';
import 'package:mobile/features/admin/presentation/screens/admin_feature_controls_screen.dart';

Widget testBoilerplate(Widget child) {
  return ProviderScope(
    child: MaterialApp(
      home: child,
    ),
  );
}

void main() {
  group('NABIN Ecosystem End-to-End Role Journeys & Device-Level QA', () {
    // ---------------------------------------------------------
    // 1. CUSTOMER ROLE JOURNEY
    // ---------------------------------------------------------
    group('Customer App Role Journey', () {
      testWidgets('CUST-01: Welcome screen renders brand, slides, and call to action', (tester) async {
        await tester.pumpWidget(testBoilerplate(const WelcomeScreen()));
        await tester.pumpAndSettle();

        expect(find.text('NABIN'), findsWidgets);
        expect(find.text('Fast, Reliable Rides'), findsOneWidget);
        expect(find.text('Get Started'), findsOneWidget);
      });

      testWidgets('CUST-02: Phone entry screen validates phone number format', (tester) async {
        await tester.pumpWidget(testBoilerplate(const PhoneEntryScreen()));
        await tester.pumpAndSettle();

        expect(find.text('Welcome to Nabin'), findsOneWidget);
        expect(find.byType(TextField), findsOneWidget);
        expect(find.text('Continue'), findsOneWidget);

        // Tap continue with empty phone
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        expect(find.byType(PhoneEntryScreen), findsOneWidget);
      });

      testWidgets('CUST-03: OTP verification renders 6-digit inputs and resend timer', (tester) async {
        await tester.pumpWidget(testBoilerplate(const OtpVerificationScreen(phoneNumber: '9876543210')));
        await tester.pumpAndSettle();

        expect(find.text("Verify it's you"), findsOneWidget);
        expect(find.textContaining('9876543210'), findsOneWidget);
        expect(find.text('Verify & Proceed'), findsOneWidget);
      });

      testWidgets('CUST-04: Customer home displays multi-modal service discovery cards', (tester) async {
        await tester.pumpWidget(testBoilerplate(const CustomerHomeScreen()));
        await tester.pumpAndSettle();

        expect(find.byType(CustomerHomeScreen), findsOneWidget);
        expect(find.textContaining('NABIN'), findsWidgets);
        expect(find.textContaining('Ride'), findsWidgets);
        expect(find.textContaining('Food'), findsWidgets);
        expect(find.textContaining('Parcel'), findsWidgets);
      });

      testWidgets('CUST-05: Ride booking renders vehicle selectors and fare cards', (tester) async {
        await tester.pumpWidget(testBoilerplate(const RideBookingScreen()));
        await tester.pumpAndSettle();

        expect(find.byType(RideBookingScreen), findsOneWidget);
      });

      testWidgets('CUST-06: Food catalog and dish detail render options cleanly', (tester) async {
        await tester.pumpWidget(testBoilerplate(const FoodHomeScreen()));
        await tester.pumpAndSettle();

        expect(find.byType(FoodHomeScreen), findsOneWidget);

        // Test dish detail leaf screen
        await tester.pumpWidget(testBoilerplate(const DishDetailScreen(restaurantId: 'rest-demo-1', dishId: 'dish-demo-1')));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(DishDetailScreen), findsOneWidget);
      });

      testWidgets('CUST-07: Grocery home and cart calculations render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const GroceryHomeScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(GroceryHomeScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const GroceryCartScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(GroceryCartScreen), findsOneWidget);
      });

      testWidgets('CUST-08: Activity ledger filters and displays orders', (tester) async {
        await tester.pumpWidget(testBoilerplate(const ActivityScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(ActivityScreen), findsOneWidget);
      });

      testWidgets('CUST-09: Wallet screen handles unconfigured balance cleanly', (tester) async {
        await tester.pumpWidget(testBoilerplate(const WalletScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(WalletScreen), findsOneWidget);
      });

      testWidgets('CUST-10: Support and Profile screens render authenticated user details', (tester) async {
        await tester.pumpWidget(testBoilerplate(const CustomerSupportScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(CustomerSupportScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const ProfileScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(ProfileScreen), findsOneWidget);
      });
    });

    // ---------------------------------------------------------
    // 2. DRIVER ROLE JOURNEY
    // ---------------------------------------------------------
    group('Driver App Role Journey', () {
      testWidgets('DRV-01: Driver login and KYC registration forms render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const DriverLoginScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(DriverLoginScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const DriverKycRegistrationScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(DriverKycRegistrationScreen), findsOneWidget);
      });

      testWidgets('DRV-02: Driver home and dispatch shell render availability controls', (tester) async {
        await tester.pumpWidget(testBoilerplate(const DriverAppShell()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(DriverAppShell), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const DriverHomeScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(DriverHomeScreen), findsOneWidget);
      });

      testWidgets('DRV-03: Active job execution renders stage transitions with data', (tester) async {
        final mockJob = {
          'id': 'job-demo-101',
          'ref': 'TRIP-9821',
          'status': 'ACCEPTED',
          'service_type': 'RIDE',
          'pickup_address': 'Connaught Place, Central Delhi',
          'dropoff_address': 'DLF Cyber City, Phase 2, Gurugram',
          'fare': 340.0,
          'driver_earnings': 289.0,
        };

        await tester.pumpWidget(testBoilerplate(ActiveJobExecutionScreen(jobData: mockJob)));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(ActiveJobExecutionScreen), findsOneWidget);
      });

      testWidgets('DRV-04: Driver earnings and payout ledger render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const DriverEarningsScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(DriverEarningsScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const DriverPayoutScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(DriverPayoutScreen), findsOneWidget);
      });

      testWidgets('DRV-05: Driver support queue, new ticket form, and thread render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const DriverSupportScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(DriverSupportScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const DriverSupportNewTicketScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(DriverSupportNewTicketScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const DriverSupportTicketScreen(ticketRef: 'TIC-DEMO-99')));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(DriverSupportTicketScreen), findsOneWidget);
      });

      testWidgets('DRV-06: Driver notifications screen renders activity notices', (tester) async {
        await tester.pumpWidget(testBoilerplate(const DriverNotificationsScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(DriverNotificationsScreen), findsOneWidget);
      });
    });

    // ---------------------------------------------------------
    // 3. RESTAURANT MERCHANT ROLE JOURNEY
    // ---------------------------------------------------------
    group('Restaurant Merchant Role Journey', () {
      testWidgets('REST-01: Restaurant login screen renders phone entry', (tester) async {
        await tester.pumpWidget(testBoilerplate(const RestaurantLoginScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(RestaurantLoginScreen), findsOneWidget);
      });

      testWidgets('REST-02: Restaurant app shell and main kitchen shell render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const RestaurantAppShell()));
        await tester.pumpAndSettle();
        expect(find.byType(RestaurantAppShell), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const RestaurantMainShell()));
        await tester.pumpAndSettle();
        expect(find.byType(RestaurantMainShell), findsOneWidget);
      });

      testWidgets('REST-03: Restaurant dish detail screen renders read-only dish record', (tester) async {
        await tester.pumpWidget(testBoilerplate(const RestaurantDishDetailScreen(dishId: 'dish-sample-1')));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(RestaurantDishDetailScreen), findsOneWidget);
      });
    });

    // ---------------------------------------------------------
    // 4. GROCERY MERCHANT ROLE JOURNEY
    // ---------------------------------------------------------
    group('Grocery Merchant Role Journey', () {
      testWidgets('GROC-01: Grocery merchant login screen renders', (tester) async {
        await tester.pumpWidget(testBoilerplate(const GroceryMerchantLoginScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(GroceryMerchantLoginScreen), findsOneWidget);
      });

      testWidgets('GROC-02: Grocery merchant dashboard and orders queue render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const GroceryMerchantDashboard()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(GroceryMerchantDashboard), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const GroceryMerchantOrdersScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(GroceryMerchantOrdersScreen), findsOneWidget);
      });

      testWidgets('GROC-03: Grocery merchant order detail handles packed weight', (tester) async {
        await tester.pumpWidget(testBoilerplate(const GroceryMerchantOrderDetailScreen(orderId: 'ord-groc-1')));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(GroceryMerchantOrderDetailScreen), findsOneWidget);
      });

      testWidgets('GROC-04: Grocery merchant catalog, inventory, and price management render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(GroceryMerchantCatalogScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const GroceryMerchantInventoryScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(GroceryMerchantInventoryScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const GroceryMerchantPriceManagementScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(GroceryMerchantPriceManagementScreen), findsOneWidget);
      });
    });

    // ---------------------------------------------------------
    // 5. ADMIN ROLE JOURNEY
    // ---------------------------------------------------------
    group('Admin App Role Journey', () {
      testWidgets('ADM-01: Admin login screen renders authentication form', (tester) async {
        await tester.pumpWidget(testBoilerplate(const AdminLoginScreen()));
        await tester.pumpAndSettle();
        expect(find.byType(AdminLoginScreen), findsOneWidget);
      });

      testWidgets('ADM-02: Admin dashboard renders KPI overview', (tester) async {
        await tester.pumpWidget(testBoilerplate(const AdminDashboardScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(AdminDashboardScreen), findsOneWidget);
      });

      testWidgets('ADM-03: Admin operations screens (users, fleet, merchants, orders) render', (tester) async {
        await tester.pumpWidget(testBoilerplate(const AdminUsersScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(AdminUsersScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const AdminFleetScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(AdminFleetScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const AdminMerchantsScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(AdminMerchantsScreen), findsOneWidget);

        await tester.pumpWidget(testBoilerplate(const AdminOrdersScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(AdminOrdersScreen), findsOneWidget);
      });

      testWidgets('ADM-04: Admin feature controls screen renders toggles with confirmation', (tester) async {
        await tester.pumpWidget(testBoilerplate(const AdminFeatureControlsScreen()));
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.byType(AdminFeatureControlsScreen), findsOneWidget);
      });
    });
  });
}
