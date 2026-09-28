import 'package:go_router/go_router.dart';
import '../network/session_manager.dart';
import '../../features/auth/presentation/screens/driver_splash_screen.dart';
import '../../features/auth/presentation/screens/driver_login_screen.dart';
import '../../features/auth/presentation/screens/driver_otp_screen.dart';
import '../../features/auth/presentation/screens/driver_kyc_registration_screen.dart';
import '../../features/home/presentation/screens/driver_home_screen.dart';
import '../../features/job/presentation/screens/active_job_execution_screen.dart';
import '../../features/earnings/presentation/screens/driver_earnings_screen.dart';
import '../../features/account/presentation/screens/driver_account_screen.dart';

/// Screens a partner may reach before NABIN has said who they are.
const Set<String> _driverPublicRoutes = {'/', '/login', '/otp', '/kyc-registration'};

/// Deduplicated GoRouter exclusively for ONE NABIN Driver App
final GoRouter driverRouter = GoRouter(
  initialLocation: '/',
  // The console, the earnings ledger and the account page all describe one named partner.
  // Without this gate a cold start that lands on any of them by deep link would render them
  // with no bearer token attached, and "no token" on those reads means 401, not "empty".
  redirect: (context, state) {
    final path = state.matchedLocation;
    final isPublic = _driverPublicRoutes.contains(path);
    if (!isPublic && !SessionManager.instance.isAuthenticated) {
      return '/login';
    }
    // A partner who is already signed in has no reason to sit on the splash or the login
    // form again.
    if ((path == '/' || path == '/login' || path == '/otp') && SessionManager.instance.isAuthenticated) {
      return '/home';
    }
    return null;
  },
  routes: [
    // 1. Auth & Registration Flow
    GoRoute(
      path: '/',
      builder: (context, state) => const DriverSplashScreen(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const DriverLoginScreen(),
    ),
    GoRoute(
      path: '/otp',
      builder: (context, state) {
        // The number comes from the login step that actually requested a code. There is no
        // stand-in: opening this screen without one means no code was ever dispatched, so it
        // returns to the step that asks for the number instead of verifying nothing.
        final phone = state.extra is String ? state.extra as String : '';
        if (phone.isEmpty) return const DriverLoginScreen();
        return DriverOtpScreen(phoneNumber: phone);
      },
    ),
    GoRoute(
      path: '/kyc-registration',
      builder: (context, state) => const DriverKycRegistrationScreen(),
    ),

    // 2. Driver Master Home
    GoRoute(
      path: '/home',
      builder: (context, state) => const DriverHomeScreen(),
    ),

    // 3. Universal Active Job Execution (Passenger Ride / Parcel / Food)
    GoRoute(
      path: '/active-job',
      builder: (context, state) {
        final job = state.extra as Map<String, dynamic>?;
        return ActiveJobExecutionScreen(jobData: job);
      },
    ),

    // 4. Earnings Dashboard & Bank Settlement
    GoRoute(
      path: '/earnings',
      builder: (context, state) => const DriverEarningsScreen(),
    ),

    // 5. Driver Profile & Account Management
    GoRoute(
      path: '/account',
      builder: (context, state) => const DriverAccountScreen(),
    ),
  ],
);
