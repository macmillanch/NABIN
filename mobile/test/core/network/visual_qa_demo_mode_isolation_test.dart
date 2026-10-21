import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/features/home/presentation/screens/customer_splash_screen.dart';

void main() {
  group('NabinApiService Visual QA Demo Mode Isolation', () {
    setUp(() {
      // Ensure clean state before each test
      NabinApiService.setVisualQaDemoMode(false);
    });

    tearDown(() {
      // Guarantee that demo mode never leaks into subsequent test suites
      NabinApiService.setVisualQaDemoMode(false);
    });

    test('flag defaults to false and is strictly opt-in', () {
      expect(NabinApiService.isVisualQaDemoMode, isFalse);
    });

    test('when demo mode is false, demo fallbacks are bypassed and real error handling occurs', () async {
      expect(NabinApiService.isVisualQaDemoMode, isFalse);

      // In production (flag = false), calling API methods attempts real network I/O
      // and does NOT return visual QA synthetic data.
      final res = await NabinApiService.getAdminMetrics();
      // Verifies that real network error handling ran and returned real failure response
      // rather than the visual QA mock object ({'success': true, 'metrics': {'totalDrivers': 48, ...}})
      expect(res, isNotNull);
      expect(res?['success'], isFalse);
      expect(res?['metrics'], isNull);
      expect(res?['error'], isNotNull);
    });

    test('when demo mode is true, visual QA fixtures are returned', () async {
      NabinApiService.setVisualQaDemoMode(true);
      expect(NabinApiService.isVisualQaDemoMode, isTrue);

      final metrics = await NabinApiService.getAdminMetrics();
      expect(metrics, isNotNull);
      expect(metrics?['success'], isTrue);
      expect(metrics?['metrics']?['totalDrivers'], equals(48));

      final dashboard = await NabinApiService.getMerchantDashboard('rest-test-01');
      expect(dashboard, isNotNull);
      expect(dashboard?['restaurant']?['id'], equals('rest-test-01'));
      expect(dashboard?['activeOrdersCount'], equals(3));
      expect(dashboard?['todaySales'], equals(4850.0));
    });

    test('resetting flag to false restores real network behavior without leakage', () async {
      NabinApiService.setVisualQaDemoMode(true);
      expect(NabinApiService.isVisualQaDemoMode, isTrue);

      // Turn off
      NabinApiService.setVisualQaDemoMode(false);
      expect(NabinApiService.isVisualQaDemoMode, isFalse);

      final res = await NabinApiService.getAdminDrivers();
      // Should attempt real network I/O and return null in offline test environment (not mock drivers list)
      expect(res, isNull);
    });
  });

  group('CustomerSplashScreen autoRoute Isolation', () {
    testWidgets('QA harness can disable auto-routing (autoRoute: false) to keep splash frame mounted', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: CustomerSplashScreen(autoRoute: false),
        ),
      );
      await tester.pump();
      await tester.pump();

      // Screen remains mounted because autoRoute is false
      expect(find.byType(CustomerSplashScreen), findsOneWidget);
      expect(find.text('NABIN'), findsOneWidget);
      expect(find.text('SUPER APP'), findsOneWidget);
      expect(find.text('Ride  •  Food  •  Grocery  •  Parcel'), findsOneWidget);
    });

    testWidgets('default constructor autoRoute is true', (tester) async {
      const splash = CustomerSplashScreen();
      expect(splash.autoRoute, isTrue);
    });
  });
}
