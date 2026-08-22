import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/screens/driver_splash_screen.dart';
import '../../features/auth/presentation/screens/driver_login_screen.dart';
import '../../features/auth/presentation/screens/driver_otp_screen.dart';
import '../../features/auth/presentation/screens/driver_kyc_registration_screen.dart';
import '../../features/home/presentation/screens/driver_home_screen.dart';
import '../../features/job/presentation/screens/active_job_execution_screen.dart';
import '../../features/earnings/presentation/screens/driver_earnings_screen.dart';
import '../../features/account/presentation/screens/driver_account_screen.dart';

/// Deduplicated GoRouter exclusively for ONE NABIN Driver App
final GoRouter driverRouter = GoRouter(
  initialLocation: '/',
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
        final phone = state.extra as String? ?? '9876543210';
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
