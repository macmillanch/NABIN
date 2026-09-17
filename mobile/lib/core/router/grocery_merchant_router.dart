import 'package:go_router/go_router.dart';
import '../../features/grocery_merchant/presentation/screens/grocery_merchant_splash_screen.dart';
import '../../features/grocery_merchant/presentation/screens/grocery_merchant_login_screen.dart';
import '../../features/grocery_merchant/presentation/screens/grocery_merchant_otp_screen.dart';
import '../../features/grocery_merchant/presentation/screens/grocery_merchant_dashboard.dart';
import '../../features/grocery_merchant/presentation/screens/grocery_merchant_orders_screen.dart';
import '../../features/grocery_merchant/presentation/screens/grocery_merchant_order_detail_screen.dart';
import '../../features/grocery_merchant/presentation/screens/grocery_merchant_inventory_screen.dart';

/// GoRouter exclusively for the NABIN Grocery Merchant App
final GoRouter groceryMerchantRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const GroceryMerchantSplashScreen(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const GroceryMerchantLoginScreen(),
    ),
    GoRoute(
      path: '/otp',
      builder: (context, state) {
        final phone = state.extra as String? ?? '';
        return GroceryMerchantOtpScreen(phoneNumber: phone);
      },
    ),
    GoRoute(
      path: '/dashboard',
      builder: (context, state) => const GroceryMerchantDashboard(),
    ),
    GoRoute(
      path: '/orders',
      builder: (context, state) => const GroceryMerchantOrdersScreen(),
    ),
    GoRoute(
      path: '/orders/:orderId',
      builder: (context, state) {
        final orderId = state.pathParameters['orderId'] ?? '';
        return GroceryMerchantOrderDetailScreen(orderId: orderId);
      },
    ),
    GoRoute(
      path: '/inventory',
      builder: (context, state) => const GroceryMerchantInventoryScreen(),
    ),
  ],
);
