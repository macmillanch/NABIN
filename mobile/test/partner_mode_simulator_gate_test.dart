import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:mobile/core/config/nabin_build_env.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/widgets/nabin_demo_simulator_banner.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_app_shell.dart';

// The two hosts already exist and already serve the reads these screens make. Rebuilding
// that scaffolding here would give this file its own chance to be wrong.
import 'customer_home_discovery_test.dart' as home_host;
import 'customer_profile_test.dart' as profile_host;

import 'support/http_stub.dart';

// The Customer app carries a Driver console and a Restaurant console so a partner journey
// can be walked from one device. Nothing in either shell is read from the platform: the
// widgets paint 'Rajesh Kumar', '+91 98765 43210', '✓ KYC Approved • ⭐ 4.92 Rating' and
// '₹28,450' as if they were a real partner's account. Until this ticket, Home and Profile
// each offered a one-tap route into that, in every build including the one a real customer
// installs.
//
// The gate is `NabinBuildEnv.allowsDemoConvenience`, which is `String.fromEnvironment` —
// fixed when the build compiles, so it cannot be read as an ordinary unit test. These
// assertions are therefore written as invariants of whichever build is running, and the
// file is executed twice:
//
//   flutter test test/partner_mode_simulator_gate_test.dart
//   flutter test --dart-define=NABIN_ENV=production test/partner_mode_simulator_gate_test.dart
//
// The first run proves the demo surface survives with its label; the second proves a
// production build has neither the doors nor the routes, so a deep link to one of them
// lands on go_router's own "no route found" screen instead of a lying simulator.

/// Every path registered on the router, walked through nesting.
List<String> routePaths(GoRouter router) {
  final found = <String>[];
  void walk(RouteBase route) {
    if (route is GoRoute) {
      found.add(route.path);
    }
    for (final child in route.routes) {
      walk(child);
    }
  }
  for (final top in router.configuration.routes) {
    walk(top);
  }
  return found;
}

/// Mounts one of the simulators at a given logical width and lets it settle without
/// `pumpAndSettle`, which never returns on a shell with a repeating animation.
Future<void> pumpShell(WidgetTester tester, Widget shell, {required double width}) async {
  HttpOverrides.global = StubHttpOverrides();
  stubReset();
  addTearDown(() => HttpOverrides.global = null);
  tester.view.physicalSize = Size(width, 852);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.runAsync(() => tester.pumpWidget(MaterialApp(home: shell)));
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  final bool demoAllowed = NabinBuildEnv.allowsDemoConvenience;
  final Matcher expected = demoAllowed ? findsOneWidget : findsNothing;

  group('simulator routes', () {
    const List<String> simulators = <String>[
      '/driver-dashboard',
      '/restaurant-dashboard',
    ];

    test('exist exactly when this build may offer demo convenience', () {
      final paths = routePaths(appRouter);
      for (final path in simulators) {
        expect(
          paths.contains(path),
          demoAllowed,
          reason: demoAllowed
              ? 'a demo build has to keep $path'
              : 'a build for real users must not answer $path with sample data',
        );
      }
    });

    test('nothing else on this router was gated along with them', () {
      // The gate belongs to the simulators and nowhere else. If a real customer route ever
      // rode the same condition, a production build would silently lose a feature, and a
      // containsAll on the journey this app actually ships is the check for that.
      const List<String> always = <String>[
        '/splash', '/', '/phone-entry', '/otp-verification', '/personalization',
        '/identity-verification-submit', '/identity-verification-status', '/home',
        '/ride-booking', '/active-ride', '/ride-receipt', '/parcel-booking',
        '/parcel-confirmation', '/payment', '/food-home', '/food-categories',
        '/restaurant-menu', '/dish-detail', '/food-checkout', '/food-tracking',
        '/grocery-home', '/grocery-cart', '/grocery-checkout', '/grocery-categories',
        '/grocery-products', '/grocery-product-detail', '/grocery-deals',
        '/wallet', '/activity', '/profile', '/support',
      ];
      expect(routePaths(appRouter), containsAll(always));
    });
  });

  group('entry points a customer can reach', () {
    setUp(() {
      HttpOverrides.global = StubHttpOverrides();
      stubReset();
      SessionManager.instance.saveSession(
        token: 'test-token',
        user: <String, dynamic>{'id': 'usr_real_42', 'name': 'Lalthanmawli Vanminuwa'},
      );
    });

    tearDown(() {
      HttpOverrides.global = null;
      SessionManager.instance.clearSession();
    });

    testWidgets('Home offers the partner simulators only to a demo build', (tester) async {
      home_host.serve();
      await home_host.pumpHome(tester);

      expect(find.text('Partner with NABIN'), expected);
      expect(find.text('Driver Mode'), expected);
      // The card is hidden as one unit, so a production build keeps no empty titled box.
      expect(find.textContaining('Demo simulators of the partner apps'), expected);
    });

    testWidgets('Profile offers them only to a demo build', (tester) async {
      profile_host.serve();
      await profile_host.pumpProfile(tester);

      expect(find.text('Partner Ecosystem'), expected);
      expect(find.text('Switch to Driver Partner Mode'), expected);
      expect(find.text('Switch to Merchant Partner Portal'), expected);
    });
  });

  group('the label on a surface that imitates another app', () {
    testWidgets('names the surface and refuses to be read as an account', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: NabinDemoSimulatorBanner(surface: 'the Driver app'),
          ),
        ),
      );

      expect(find.text('DEMO SIMULATOR'), findsOneWidget);
      expect(find.textContaining('the Driver app'), findsOneWidget);
      expect(
        find.textContaining('sample text written into this build'),
        findsOneWidget,
        reason: 'the strip has to say the numbers are not measurements, not just be titled',
      );
      expect(find.textContaining('nothing you do here reaches NABIN'), findsOneWidget);
    });

    testWidgets('the Restaurant simulator paints the label above its sample settlement', (tester) async {
      await pumpShell(tester, const RestaurantAppShell(), width: 834);

      expect(find.text('DEMO SIMULATOR'), findsOneWidget);
      expect(find.textContaining('the Restaurant Partner app'), findsOneWidget);

      // The strip only earns its place if it is still on screen where the fabricated
      // number is. That number lives on the Earnings tab, so the test goes there.
      await tester.tap(find.descendant(
        of: find.byType(BottomNavigationBar),
        matching: find.text('Earnings'),
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));

      expect(find.text('₹28,450'), findsOneWidget);
      expect(
        find.text('DEMO SIMULATOR'),
        findsOneWidget,
        reason: 'the disclaimer has to survive tab switching, not just the first frame',
      );
    });

    test('both simulators wire the strip into their own body', () {
      // The Driver simulator is not mounted here: its first tab is a live flutter_map,
      // whose tile cache asks the path_provider and sqlite plugins for a filesystem, and a
      // widget test has neither. What can be checked without a device is that both shells
      // put the strip above their own tabs — the render of the strip itself, and of this
      // frame around a Scaffold + AppBar + IndexedStack, is asserted above.
      for (final path in <String>[
        'lib/features/driver/presentation/screens/driver_app_shell.dart',
        'lib/features/restaurant/presentation/screens/restaurant_app_shell.dart',
      ]) {
        final source = File(path).readAsStringSync();
        expect(
          source.contains('NabinDemoSimulatorBanner('),
          isTrue,
          reason: '$path paints a sample partner, so it has to say so on screen',
        );
      }
    });
  });
}
