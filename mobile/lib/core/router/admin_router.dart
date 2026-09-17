import 'package:go_router/go_router.dart';
import '../../features/admin/presentation/screens/admin_splash_screen.dart';
import '../../features/admin/presentation/screens/admin_login_screen.dart';
import '../../features/admin/presentation/screens/admin_otp_screen.dart';
import '../../features/admin/presentation/screens/admin_dashboard_screen.dart';
import '../../features/admin/presentation/screens/admin_feature_controls_screen.dart';
import '../../features/admin/presentation/screens/admin_users_screen.dart';
import '../../features/admin/presentation/screens/admin_fleet_screen.dart';
import '../../features/admin/presentation/screens/admin_merchants_screen.dart';
import '../../features/admin/presentation/screens/admin_orders_screen.dart';

/// GoRouter for the NABIN Admin App
final GoRouter adminRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const AdminSplashScreen(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const AdminLoginScreen(),
    ),
    GoRoute(
      path: '/otp',
      builder: (context, state) {
        final phone = state.extra as String? ?? '';
        return AdminOtpScreen(phoneNumber: phone);
      },
    ),
    GoRoute(
      path: '/dashboard',
      builder: (context, state) => const AdminDashboardScreen(),
    ),
    GoRoute(
      path: '/features',
      builder: (context, state) => const AdminFeatureControlsScreen(),
    ),
    GoRoute(
      path: '/users',
      builder: (context, state) => const AdminUsersScreen(),
    ),
    GoRoute(
      path: '/drivers',
      builder: (context, state) => const AdminFleetScreen(),
    ),
    GoRoute(
      path: '/merchants',
      builder: (context, state) => const AdminMerchantsScreen(),
    ),
    GoRoute(
      path: '/orders',
      builder: (context, state) => const AdminOrdersScreen(),
    ),
  ],
);
