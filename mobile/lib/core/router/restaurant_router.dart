import 'package:go_router/go_router.dart';
import '../../features/restaurant/presentation/screens/restaurant_splash_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_login_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_otp_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_registration_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_main_shell.dart';

/// Deduplicated GoRouter exclusively for ONE NABIN Restaurant App
final GoRouter restaurantRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const RestaurantSplashScreen(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const RestaurantLoginScreen(),
    ),
    GoRoute(
      path: '/otp',
      builder: (context, state) {
        final phone = state.extra as String? ?? '9876543210';
        return RestaurantOtpScreen(phoneNumber: phone);
      },
    ),
    GoRoute(
      path: '/registration',
      builder: (context, state) => const RestaurantRegistrationScreen(),
    ),
    GoRoute(
      path: '/dashboard',
      builder: (context, state) => const RestaurantMainShell(),
    ),
  ],
);
