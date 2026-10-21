import 'package:go_router/go_router.dart';
import '../network/session_manager.dart';
import '../../features/auth/presentation/screens/driver_splash_screen.dart';
import '../../features/auth/presentation/screens/driver_login_screen.dart';
import '../../features/auth/presentation/screens/driver_otp_screen.dart';
import '../../features/auth/presentation/screens/driver_kyc_registration_screen.dart';
import '../../features/home/presentation/screens/driver_home_screen.dart';
import '../../features/job/presentation/screens/active_job_execution_screen.dart';
import '../../features/earnings/presentation/screens/driver_earnings_screen.dart';
import '../../features/payout/presentation/screens/driver_payout_screen.dart';
import '../../features/account/presentation/screens/driver_account_screen.dart';
import '../../features/notifications/presentation/screens/driver_notifications_screen.dart';
import '../../features/notifications/presentation/screens/driver_notification_preferences_screen.dart';
import '../../features/support/presentation/screens/driver_support_screen.dart';
import '../../features/support/presentation/screens/driver_support_new_ticket_screen.dart';
import '../../features/support/presentation/screens/driver_support_ticket_screen.dart';

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

    // 4b. Payout destination. Both halves key on the bearer token — the read comes from the
    // earnings block and the write is `POST /api/driver/payout-destination/request`, which
    // derives the partner from the token — so the route carries no driver id. It is not in
    // `_driverPublicRoutes`, so a cold deep link lands on the login gate rather than on a
    // screen rendering a 401 as "no destination on file".
    GoRoute(
      path: '/payout',
      builder: (context, state) => const DriverPayoutScreen(),
    ),

    // 5. Driver Profile & Account Management
    GoRoute(
      path: '/account',
      builder: (context, state) => const DriverAccountScreen(),
    ),

    // 6. Notifications and what the partner is told about. Both reads and both writes key on
    // the bearer token, so neither route carries an id — and neither is in the public set, so
    // a cold deep link here goes through the login gate rather than rendering a 401 feed.
    GoRoute(
      path: '/notifications',
      builder: (context, state) => const DriverNotificationsScreen(),
    ),
    GoRoute(
      path: '/notifications/preferences',
      builder: (context, state) => const DriverNotificationPreferencesScreen(),
    ),

    // 7. Support tickets. All three reads and writes derive the partner from the bearer token,
    // so none of them takes an identity from a link: `/support/ticket/:ref` carries a ticket
    // reference, which the server resolves against the caller's own rows and answers 404 for
    // anything else. None of these is in `_driverPublicRoutes`, so a cold deep link goes through
    // the sign-in gate rather than rendering a 401 as an empty inbox.
    GoRoute(
      path: '/support',
      builder: (context, state) => const DriverSupportScreen(),
    ),
    GoRoute(
      path: '/support/new',
      builder: (context, state) => const DriverSupportNewTicketScreen(),
    ),
    GoRoute(
      path: '/support/ticket/:ref',
      builder: (context, state) {
        final ref = state.pathParameters['ref'] ?? '';
        // A thread needs a row to reply to. With no reference in the link there is nothing to
        // select, so the list is the honest destination rather than an empty conversation.
        if (ref.isEmpty) return const DriverSupportScreen();
        return DriverSupportTicketScreen(ticketRef: ref);
      },
    ),
  ],
);
