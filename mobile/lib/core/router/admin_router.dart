import 'package:go_router/go_router.dart';
import '../../features/admin/presentation/screens/admin_splash_screen.dart';
import '../../features/admin/presentation/screens/admin_login_screen.dart';
import '../../features/admin/presentation/screens/admin_otp_screen.dart';
import '../../features/admin/presentation/screens/admin_dashboard_screen.dart';
import '../../features/admin/presentation/screens/admin_feature_controls_screen.dart';

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
  ],
);
