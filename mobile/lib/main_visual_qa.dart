import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/config/nabin_config_controller.dart';
import 'core/config/nabin_config_lifecycle.dart';
import 'core/network/nabin_api_service.dart';
import 'core/network/session_manager.dart';
import 'core/theme/app_theme.dart';

// ==========================================
// 1. Customer Screens (37)
// ==========================================
import 'features/home/presentation/screens/customer_splash_screen.dart';
import 'features/auth/presentation/screens/welcome_screen.dart';
import 'features/auth/presentation/screens/phone_entry_screen.dart';
import 'features/auth/presentation/screens/otp_verification_screen.dart';
import 'features/auth/presentation/screens/personalization_screen.dart';
import 'features/auth/presentation/screens/identity_verification_submission_screen.dart';
import 'features/auth/presentation/screens/identity_verification_status_screen.dart';
import 'features/home/presentation/screens/customer_home_screen.dart';
import 'features/ride/presentation/screens/ride_booking_screen.dart';
import 'features/ride/presentation/screens/active_ride_screen.dart';
import 'features/ride/presentation/screens/ride_receipt_screen.dart';
import 'features/parcel/presentation/screens/parcel_booking_screen.dart';
import 'features/parcel/presentation/screens/parcel_confirmation_screen.dart';
import 'features/payment/presentation/screens/payment_screen.dart';
import 'features/food/presentation/screens/food_home_screen.dart';
import 'features/food/presentation/screens/food_category_screen.dart';
import 'features/food/presentation/screens/restaurant_menu_screen.dart';
import 'features/food/presentation/screens/dish_detail_screen.dart';
import 'features/food/presentation/screens/food_checkout_screen.dart';
import 'features/food/presentation/screens/food_order_tracking_screen.dart';
import 'features/grocery/presentation/screens/grocery_app_shell.dart';
import 'features/grocery/presentation/screens/grocery_home_screen.dart';
import 'features/grocery/presentation/screens/grocery_categories_screen.dart';
import 'features/grocery/presentation/screens/grocery_products_screen.dart';
import 'features/grocery/presentation/screens/grocery_product_detail_screen.dart';
import 'features/grocery/presentation/screens/grocery_cart_screen.dart';
import 'features/grocery/presentation/screens/grocery_checkout_screen.dart';
import 'features/grocery/presentation/screens/grocery_order_status_screen.dart';
import 'features/grocery/presentation/screens/grocery_deals_screen.dart';
import 'features/grocery/presentation/screens/grocery_account_screen.dart';
import 'features/grocery/presentation/screens/grocery_login_screen.dart';
import 'features/grocery/presentation/screens/grocery_otp_screen.dart';
import 'features/grocery/presentation/screens/grocery_splash_screen.dart';
import 'features/activity/presentation/screens/activity_screen.dart';
import 'features/profile/presentation/screens/profile_screen.dart';
import 'features/support/presentation/screens/customer_support_screen.dart';
import 'features/wallet/presentation/screens/wallet_screen.dart';

// ==========================================
// 2. Driver Screens (15)
// ==========================================
import 'features/auth/presentation/screens/driver_splash_screen.dart';
import 'features/auth/presentation/screens/driver_login_screen.dart';
import 'features/auth/presentation/screens/driver_otp_screen.dart';
import 'features/auth/presentation/screens/driver_kyc_registration_screen.dart';
import 'features/driver/presentation/screens/driver_app_shell.dart';
import 'features/home/presentation/screens/driver_home_screen.dart';
import 'features/job/presentation/screens/active_job_execution_screen.dart';
import 'features/earnings/presentation/screens/driver_earnings_screen.dart';
import 'features/payout/presentation/screens/driver_payout_screen.dart';
import 'features/notifications/presentation/screens/driver_notifications_screen.dart';
import 'features/notifications/presentation/screens/driver_notification_preferences_screen.dart';
import 'features/support/presentation/screens/driver_support_screen.dart';
import 'features/support/presentation/screens/driver_support_ticket_screen.dart';
import 'features/support/presentation/screens/driver_support_new_ticket_screen.dart';
import 'features/account/presentation/screens/driver_account_screen.dart';

// ==========================================
// 3. Restaurant Merchant Screens (7)
// ==========================================
import 'features/restaurant/presentation/screens/restaurant_splash_screen.dart';
import 'features/restaurant/presentation/screens/restaurant_login_screen.dart';
import 'features/restaurant/presentation/screens/restaurant_otp_screen.dart';
import 'features/restaurant/presentation/screens/restaurant_registration_screen.dart';
import 'features/restaurant/presentation/screens/restaurant_app_shell.dart';
import 'features/restaurant/presentation/screens/restaurant_main_shell.dart';
import 'features/restaurant/presentation/screens/restaurant_dish_detail_screen.dart';
import 'features/restaurant/presentation/screens/restaurant_menu_management_screen.dart';

// ==========================================
// 4. Grocery Merchant Screens (10)
// ==========================================
import 'features/grocery_merchant/presentation/screens/grocery_merchant_splash_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_login_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_otp_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_dashboard.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_orders_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_order_detail_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_catalog_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_inventory_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_price_management_screen.dart';
import 'features/grocery_merchant/presentation/screens/grocery_merchant_notifications_screen.dart';

// ==========================================
// 5. Admin Screens (9)
// ==========================================
import 'features/admin/presentation/screens/admin_splash_screen.dart';
import 'features/admin/presentation/screens/admin_login_screen.dart';
import 'features/admin/presentation/screens/admin_otp_screen.dart';
import 'features/admin/presentation/screens/admin_dashboard_screen.dart';
import 'features/admin/presentation/screens/admin_users_screen.dart';
import 'features/admin/presentation/screens/admin_merchants_screen.dart';
import 'features/admin/presentation/screens/admin_orders_screen.dart';
import 'features/admin/presentation/screens/admin_fleet_screen.dart';
import 'features/admin/presentation/screens/admin_feature_controls_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Enable visual QA demo adapter strictly within this preview entrypoint
  NabinApiService.setVisualQaDemoMode(true);

  // Seed authenticated demo session so partner and admin dashboards render without redirects
  SessionManager.instance.saveSession(
    token: 'demo-mobile-visual-qa-token',
    user: {
      'id': 'demo-user-qa-01',
      'role': 'DRIVER',
      'name': 'Lalramchhana (QA Partner)',
      'phone': '+91 98765 43210',
      'email': 'qa.partner@nabin.local',
      'status': 'ACTIVE',
    },
  );

  runApp(
    const ProviderScope(
      child: NabinConfigLifecycle(child: VisualQaSuperApp()),
    ),
  );
}

final _qaRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const _VisualQaCatalogScreen(),
    ),
    // Fallback safety redirects for internal screen initState callbacks
    GoRoute(path: '/login', redirect: (context, state) => '/driver/login'),
    GoRoute(path: '/home', redirect: (context, state) => '/customer/home'),
    GoRoute(path: '/dashboard', redirect: (context, state) => '/admin/dashboard'),

    // ==========================================
    // 1. Customer Screens (37)
    // ==========================================
    GoRoute(path: '/customer/splash', builder: (context, state) => const CustomerSplashScreen(autoRoute: false)),
    GoRoute(path: '/customer/welcome', builder: (context, state) => const WelcomeScreen()),
    GoRoute(path: '/customer/phone-entry', builder: (context, state) => const PhoneEntryScreen()),
    GoRoute(path: '/customer/otp', builder: (context, state) => const OtpVerificationScreen(phoneNumber: '9876543210')),
    GoRoute(path: '/customer/personalization', builder: (context, state) => const PersonalizationScreen()),
    GoRoute(path: '/customer/kyc-submission', builder: (context, state) => const IdentityVerificationSubmissionScreen()),
    GoRoute(path: '/customer/kyc-status', builder: (context, state) => const IdentityVerificationStatusScreen()),
    GoRoute(path: '/customer/home', builder: (context, state) => const CustomerHomeScreen()),
    GoRoute(path: '/customer/ride-booking', builder: (context, state) => const RideBookingScreen()),
    GoRoute(path: '/customer/ride-active', builder: (context, state) => const ActiveRideScreen(vehicleType: '3W', vehicleName: 'Auto', fare: '120')),
    GoRoute(path: '/customer/ride-receipt', builder: (context, state) => const RideReceiptScreen(jobId: 'DEMO-RIDE-01', fare: '₹140', vehicleType: '3W', vehicleName: 'Auto')),
    GoRoute(path: '/customer/parcel-booking', builder: (context, state) => const ParcelBookingScreen()),
    GoRoute(path: '/customer/parcel-confirmation', builder: (context, state) => const ParcelConfirmationScreen(jobId: 'DEMO-PARCEL-101', fare: '₹85')),
    GoRoute(path: '/customer/payment', builder: (context, state) => const PaymentScreen(amount: '249.00', serviceName: 'Food Delivery', referenceId: 'DEMO-ORD-8821')),
    GoRoute(path: '/customer/food-home', builder: (context, state) => const FoodHomeScreen()),
    GoRoute(path: '/customer/food-category', builder: (context, state) => const FoodCategoryScreen()),
    GoRoute(path: '/customer/restaurant-menu', builder: (context, state) => const RestaurantMenuScreen(restaurantId: 'rest-01', restaurantName: 'Aizawl Diner', deliveryMinutes: 25)),
    GoRoute(path: '/customer/dish-detail', builder: (context, state) => const DishDetailScreen(restaurantId: 'rest-01', dishId: 'dish-01')),
    GoRoute(
      path: '/customer/food-checkout',
      builder: (context, state) => const FoodCheckoutScreen(cartData: {
        'restaurantId': 'rest-01',
        'restaurantName': 'Aizawl Diner',
        'deliveryMinutes': 25,
        'items': [{'name': 'Chicken Biryani', 'price': 180, 'quantity': 1}],
      }),
    ),
    GoRoute(
      path: '/customer/food-tracking',
      builder: (context, state) => const FoodOrderTrackingScreen(orderData: {
        'id': 'DEMO-FOOD-901',
        'restaurantName': 'Aizawl Diner',
        'status': 'CONFIRMED',
      }),
    ),
    GoRoute(path: '/customer/grocery-app-shell', builder: (context, state) => const GroceryAppShell()),
    GoRoute(path: '/customer/grocery-home', builder: (context, state) => const GroceryHomeScreen()),
    GoRoute(path: '/customer/grocery-categories', builder: (context, state) => const GroceryCategoriesScreen()),
    GoRoute(path: '/customer/grocery-products', builder: (context, state) => const GroceryProductsScreen()),
    GoRoute(path: '/customer/grocery-product-detail', builder: (context, state) => const GroceryProductDetailScreen(productId: 'prod-01')),
    GoRoute(path: '/customer/grocery-cart', builder: (context, state) => const GroceryCartScreen()),
    GoRoute(
      path: '/customer/grocery-checkout',
      builder: (context, state) => const GroceryCheckoutScreen(
        cartItems: [{'id': 'p1', 'title': 'Fresh Organic Milk', 'price': 65, 'quantity': 2}],
        subtotal: 130,
      ),
    ),
    GoRoute(
      path: '/customer/grocery-order-status',
      builder: (context, state) => const GroceryOrderStatusScreen(orderData: {
        'id': 'DEMO-GROC-201',
        'totalAmount': 130,
        'status': 'RECEIVED',
      }),
    ),
    GoRoute(path: '/customer/grocery-deals', builder: (context, state) => const GroceryDealsScreen()),
    GoRoute(path: '/customer/grocery-account', builder: (context, state) => const GroceryAccountScreen()),
    GoRoute(path: '/customer/grocery-login', builder: (context, state) => const GroceryLoginScreen()),
    GoRoute(path: '/customer/grocery-otp', builder: (context, state) => const GroceryOtpScreen(phoneNumber: '9876543210')),
    GoRoute(path: '/customer/grocery-splash', builder: (context, state) => const GrocerySplashScreen()),
    GoRoute(path: '/customer/activity', builder: (context, state) => const ActivityScreen()),
    GoRoute(path: '/customer/profile', builder: (context, state) => const ProfileScreen()),
    GoRoute(path: '/customer/support', builder: (context, state) => const CustomerSupportScreen()),
    GoRoute(path: '/customer/wallet', builder: (context, state) => const WalletScreen()),

    // ==========================================
    // 2. Driver Screens (15)
    // ==========================================
    GoRoute(path: '/driver/splash', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverSplashScreen())),
    GoRoute(path: '/driver/login', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverLoginScreen())),
    GoRoute(path: '/driver/otp', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverOtpScreen(phoneNumber: '9876543210'))),
    GoRoute(path: '/driver/kyc-registration', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverKycRegistrationScreen())),
    GoRoute(path: '/driver/app-shell', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverAppShell())),
    GoRoute(path: '/driver/home', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverHomeScreen())),
    GoRoute(
      path: '/driver/active-job',
      builder: (context, state) => Theme(
        data: AppTheme.driverTheme(),
        child: const ActiveJobExecutionScreen(jobData: {
          'id': 'JOB-DRV-001',
          'serviceType': 'RIDE',
          'pickup': 'Khatla, Aizawl',
          'drop': 'Bawngkawn, Aizawl',
          'fare': 160,
          'driverEarnings': 130,
          'status': 'ASSIGNED',
        }),
      ),
    ),
    GoRoute(path: '/driver/earnings', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverEarningsScreen())),
    GoRoute(path: '/driver/payout', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverPayoutScreen())),
    GoRoute(path: '/driver/notifications', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverNotificationsScreen())),
    GoRoute(path: '/driver/notification-preferences', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverNotificationPreferencesScreen())),
    GoRoute(path: '/driver/support', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverSupportScreen())),
    GoRoute(path: '/driver/support-ticket', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverSupportTicketScreen(ticketRef: 'TCK-2026-001'))),
    GoRoute(path: '/driver/support-new-ticket', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverSupportNewTicketScreen())),
    GoRoute(path: '/driver/account', builder: (context, state) => Theme(data: AppTheme.driverTheme(), child: const DriverAccountScreen())),

    // ==========================================
    // 3. Restaurant Merchant Screens (7)
    // ==========================================
    GoRoute(path: '/restaurant/splash', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantSplashScreen())),
    GoRoute(path: '/restaurant/login', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantLoginScreen())),
    GoRoute(path: '/restaurant/otp', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantOtpScreen(phoneNumber: '9876543210'))),
    GoRoute(path: '/restaurant/register', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantRegistrationScreen())),
    GoRoute(path: '/restaurant/app-shell', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantAppShell())),
    GoRoute(path: '/restaurant/dashboard', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantMainShell())),
    GoRoute(path: '/restaurant/dish-detail', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantDishDetailScreen(dishId: 'dish-01'))),
    GoRoute(path: '/restaurant/menu-management', builder: (context, state) => Theme(data: AppTheme.restaurantTheme(), child: const RestaurantMenuManagementScreen())),

    // ==========================================
    // 4. Grocery Merchant Screens (10)
    // ==========================================
    GoRoute(path: '/grocery/splash', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantSplashScreen())),
    GoRoute(path: '/grocery/login', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantLoginScreen())),
    GoRoute(path: '/grocery/otp', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantOtpScreen(phoneNumber: '9876543210'))),
    GoRoute(path: '/grocery/dashboard', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantDashboard())),
    GoRoute(path: '/grocery/orders', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantOrdersScreen())),
    GoRoute(path: '/grocery/order-detail', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantOrderDetailScreen(orderId: 'DEMO-GROC-201'))),
    GoRoute(path: '/grocery/catalog', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantCatalogScreen())),
    GoRoute(path: '/grocery/inventory', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantInventoryScreen())),
    GoRoute(path: '/grocery/price-management', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantPriceManagementScreen())),
    GoRoute(path: '/grocery/notifications', builder: (context, state) => Theme(data: AppTheme.groceryTheme(), child: const GroceryMerchantNotificationsScreen())),

    // ==========================================
    // 5. Admin Screens (9)
    // ==========================================
    GoRoute(path: '/admin/splash', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminSplashScreen())),
    GoRoute(path: '/admin/login', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminLoginScreen())),
    GoRoute(path: '/admin/otp', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminOtpScreen(phoneNumber: '9876543210'))),
    GoRoute(path: '/admin/dashboard', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminDashboardScreen())),
    GoRoute(path: '/admin/users', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminUsersScreen())),
    GoRoute(path: '/admin/merchants', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminMerchantsScreen())),
    GoRoute(path: '/admin/orders', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminOrdersScreen())),
    GoRoute(path: '/admin/fleet', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminFleetScreen())),
    GoRoute(path: '/admin/features', builder: (context, state) => Theme(data: AppTheme.adminTheme(), child: const AdminFeatureControlsScreen())),
  ],
);

class VisualQaSuperApp extends ConsumerWidget {
  const VisualQaSuperApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'NABIN Mobile Visual QA',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.customerTheme(palette: nabinPaletteOf(ref)),
      routerConfig: _qaRouter,
    );
  }
}

class _VisualQaCatalogScreen extends StatelessWidget {
  const _VisualQaCatalogScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NABIN Mobile Screen Catalog (78 Screens)'),
        backgroundColor: const Color(0xFF1A3BA2),
        foregroundColor: Colors.white,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildRoleHeader('Customer App (37 Screens)', Colors.blue.shade900),
          _buildLink(context, '1. Splash Gate', '/customer/splash'),
          _buildLink(context, '2. Welcome Onboarding', '/customer/welcome'),
          _buildLink(context, '3. Phone Entry', '/customer/phone-entry'),
          _buildLink(context, '4. OTP Verification', '/customer/otp'),
          _buildLink(context, '5. Personalization', '/customer/personalization'),
          _buildLink(context, '6. KYC Document Submission', '/customer/kyc-submission'),
          _buildLink(context, '7. KYC Verification Status', '/customer/kyc-status'),
          _buildLink(context, '8. Super App Home', '/customer/home'),
          _buildLink(context, '9. Ride Booking & Estimation', '/customer/ride-booking'),
          _buildLink(context, '10. Active Ride Tracking', '/customer/ride-active'),
          _buildLink(context, '11. Trip Completion Receipt', '/customer/ride-receipt'),
          _buildLink(context, '12. Parcel Booking', '/customer/parcel-booking'),
          _buildLink(context, '13. Parcel Booking Confirmation', '/customer/parcel-confirmation'),
          _buildLink(context, '14. Unified Checkout Payment', '/customer/payment'),
          _buildLink(context, '15. Food Home Discovery', '/customer/food-home'),
          _buildLink(context, '16. Food Cuisine Categories', '/customer/food-category'),
          _buildLink(context, '17. Restaurant Kitchen Menu', '/customer/restaurant-menu'),
          _buildLink(context, '18. Food Dish Customization', '/customer/dish-detail'),
          _buildLink(context, '19. Food Order Checkout', '/customer/food-checkout'),
          _buildLink(context, '20. Live Food Delivery Tracking', '/customer/food-tracking'),
          _buildLink(context, '21. Grocery App Shell', '/customer/grocery-app-shell'),
          _buildLink(context, '22. Grocery Express Home', '/customer/grocery-home'),
          _buildLink(context, '23. Grocery Aisle Categories', '/customer/grocery-categories'),
          _buildLink(context, '24. Grocery Department Products', '/customer/grocery-products'),
          _buildLink(context, '25. Grocery Product Detail Sheet', '/customer/grocery-product-detail'),
          _buildLink(context, '26. Grocery Basket & Cart', '/customer/grocery-cart'),
          _buildLink(context, '27. Grocery Quick Checkout', '/customer/grocery-checkout'),
          _buildLink(context, '28. Grocery Order Status & Countdown', '/customer/grocery-order-status'),
          _buildLink(context, '29. Grocery Flash Deals', '/customer/grocery-deals'),
          _buildLink(context, '30. Grocery User Account', '/customer/grocery-account'),
          _buildLink(context, '31. Grocery Login Gate', '/customer/grocery-login'),
          _buildLink(context, '32. Grocery OTP Verification', '/customer/grocery-otp'),
          _buildLink(context, '33. Grocery Kinetic Splash', '/customer/grocery-splash'),
          _buildLink(context, '34. Unified Order Activity', '/customer/activity'),
          _buildLink(context, '35. Profile & Preferences', '/customer/profile'),
          _buildLink(context, '36. Customer Support Center', '/customer/support'),
          _buildLink(context, '37. Customer Wallet & Ledger', '/customer/wallet'),
          const Divider(height: 32),

          _buildRoleHeader('Driver App (15 Screens)', Colors.green.shade800),
          _buildLink(context, '38. Driver Splash', '/driver/splash'),
          _buildLink(context, '39. Driver Login', '/driver/login'),
          _buildLink(context, '40. Driver OTP Verification', '/driver/otp'),
          _buildLink(context, '41. Driver KYC Registration', '/driver/kyc-registration'),
          _buildLink(context, '42. Driver App Shell (Map/Dispatch)', '/driver/app-shell'),
          _buildLink(context, '43. Driver Dispatch Home', '/driver/home'),
          _buildLink(context, '44. Active Job Execution & OTP', '/driver/active-job'),
          _buildLink(context, '45. Driver Earnings Breakdown', '/driver/earnings'),
          _buildLink(context, '46. Driver Payout Ledger', '/driver/payout'),
          _buildLink(context, '47. Driver Notification Feed', '/driver/notifications'),
          _buildLink(context, '48. Notification Preferences', '/driver/notification-preferences'),
          _buildLink(context, '49. Driver Support Tickets Queue', '/driver/support'),
          _buildLink(context, '50. Support Ticket Thread', '/driver/support-ticket'),
          _buildLink(context, '51. Create Support Ticket Form', '/driver/support-new-ticket'),
          _buildLink(context, '52. Driver Account & Profile', '/driver/account'),
          const Divider(height: 32),

          _buildRoleHeader('Restaurant Merchant App (7 Screens)', Colors.orange.shade900),
          _buildLink(context, '53. Restaurant Splash', '/restaurant/splash'),
          _buildLink(context, '54. Restaurant Login', '/restaurant/login'),
          _buildLink(context, '55. Restaurant OTP', '/restaurant/otp'),
          _buildLink(context, '56. FSSAI & Store Registration', '/restaurant/register'),
          _buildLink(context, '57. Restaurant App Shell', '/restaurant/app-shell'),
          _buildLink(context, '58. Restaurant Kitchen KDS Shell', '/restaurant/dashboard'),
          _buildLink(context, '59. Restaurant Dish Configuration', '/restaurant/dish-detail'),
          const Divider(height: 32),

          _buildRoleHeader('Grocery Merchant App (10 Screens)', Colors.teal.shade900),
          _buildLink(context, '60. Grocery Merchant Splash', '/grocery/splash'),
          _buildLink(context, '61. Grocery Merchant Login', '/grocery/login'),
          _buildLink(context, '62. Grocery Merchant OTP', '/grocery/otp'),
          _buildLink(context, '63. Darkstore Overview Dashboard', '/grocery/dashboard'),
          _buildLink(context, '64. Live Grocery Orders Queue', '/grocery/orders'),
          _buildLink(context, '65. Order Fulfillment & Packed Weights', '/grocery/order-detail'),
          _buildLink(context, '66. Master Catalog Stocker', '/grocery/catalog'),
          _buildLink(context, '67. Store Inventory & Stock', '/grocery/inventory'),
          _buildLink(context, '68. Price Management & Overrides', '/grocery/price-management'),
          _buildLink(context, '69. Darkstore Audio Alert Notifications', '/grocery/notifications'),
          const Divider(height: 32),

          _buildRoleHeader('Admin Mobile App (9 Screens)', Colors.indigo.shade900),
          _buildLink(context, '70. Admin Splash', '/admin/splash'),
          _buildLink(context, '71. Admin Login', '/admin/login'),
          _buildLink(context, '72. Admin OTP Verification', '/admin/otp'),
          _buildLink(context, '73. Mobile Admin Overview Dashboard', '/admin/dashboard'),
          _buildLink(context, '74. User Directory & Verification', '/admin/users'),
          _buildLink(context, '75. Merchant Network Directory', '/admin/merchants'),
          _buildLink(context, '76. Master Orders & Jobs Queue', '/admin/orders'),
          _buildLink(context, '77. Driver Fleet & Vehicle Approvals', '/admin/fleet'),
          _buildLink(context, '78. Platform Feature Controls & Switchboard', '/admin/features'),
        ],
      ),
    );
  }

  Widget _buildRoleHeader(String title, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.bold,
          color: color,
        ),
      ),
    );
  }

  Widget _buildLink(BuildContext context, String title, String path) {
    return ListTile(
      dense: true,
      title: Text(title),
      trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14),
      onTap: () => context.push(path),
    );
  }
}
