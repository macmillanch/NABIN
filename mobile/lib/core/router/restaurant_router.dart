import 'package:go_router/go_router.dart';
import '../network/session_manager.dart';
import '../../features/restaurant/presentation/screens/restaurant_splash_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_login_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_otp_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_registration_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_main_shell.dart';
import '../../features/restaurant/presentation/screens/restaurant_dish_detail_screen.dart';
import '../../features/restaurant/presentation/screens/restaurant_menu_management_screen.dart';

/// Screens reachable before NABIN has confirmed which store this is.
const Set<String> _restaurantPublicRoutes = {'/', '/login', '/otp', '/registration'};

/// Deduplicated GoRouter exclusively for ONE NABIN Restaurant App
final GoRouter restaurantRouter = GoRouter(
  initialLocation: '/',
  // The console renders one named store's orders, menu and money. Without this gate a cold
  // start landing on it would send no bearer token, and every read would fail in a way that
  // looks like "the store has no orders" rather than "nobody is signed in".
  redirect: (context, state) {
    final path = state.matchedLocation;
    final isPublic = _restaurantPublicRoutes.contains(path);
    if (!isPublic && !SessionManager.instance.isAuthenticated) return '/login';
    if ((path == '/' || path == '/login' || path == '/otp') && SessionManager.instance.isAuthenticated) {
      return '/dashboard';
    }
    return null;
  },
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
        // Only the login step that actually dispatched a code may open this screen.
        final phone = state.extra is String ? state.extra as String : '';
        if (phone.isEmpty) return const RestaurantLoginScreen();
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

    // 6. One dish from the signed-in merchant's own catalogue (R10).
    //
    // `dishId` selects a row out of the caller's own `GET /api/merchant/catalog` answer; it is
    // not an identity and grants nothing — the backend scopes that read by the bearer token, so
    // another store's dish id simply isn't in the list and lands on the not-found state. It is
    // deliberately NOT in `_restaurantPublicRoutes`, so a cold deep link goes through the sign-in
    // gate instead of painting a 401 as "this dish does not exist".
    GoRoute(
      path: '/menu/dish/:dishId',
      builder: (context, state) => RestaurantDishDetailScreen(
        dishId: state.pathParameters['dishId'] ?? '',
      ),
    ),
    GoRoute(
      path: '/menu/manage',
      builder: (context, state) => const RestaurantMenuManagementScreen(),
    ),
  ],
);
