import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile/core/config/map_config.dart';
import 'package:mobile/core/models/geo_coord.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/services/nabin_location_service.dart';
import 'package:mobile/core/services/nabin_routing_service.dart';
import 'package:mobile/core/widgets/active_trip_map_view.dart';
import 'package:mobile/features/driver/services/driver_location_manager.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Phase 1 — NabinLocationService (Permissions & GPS Acquisition)', () {
    late MockLocationSource mockSource;

    setUp(() {
      mockSource = MockLocationSource();
      NabinLocationService.instance.setSource(mockSource);
    });

    tearDown(() {
      NabinLocationService.instance.resetSource();
    });

    test('Returns granted permission and retrieves current position', () async {
      mockSource.permissionStatus = LocationPermissionStatus.granted;
      mockSource.serviceEnabled = true;
      mockSource.mockCurrentPosition = LocationPoint(
        latitude: 23.7271,
        longitude: 92.7176,
        heading: 90.0,
        speed: 12.5,
        accuracy: 8.0,
        timestamp: DateTime.now(),
      );

      final hasPerm = await NabinLocationService.instance.hasPermission();
      expect(hasPerm, isTrue);

      final status = await NabinLocationService.instance.checkPermission();
      expect(status, equals(LocationPermissionStatus.granted));

      final pos = await NabinLocationService.instance.getCurrentPosition();
      expect(pos, isNotNull);
      expect(pos!.latitude, equals(23.7271));
      expect(pos.longitude, equals(92.7176));
      expect(pos.speed, equals(12.5));
    });

    test('Handles permission denial correctly', () async {
      mockSource.permissionStatus = LocationPermissionStatus.denied;

      final hasPerm = await NabinLocationService.instance.hasPermission();
      expect(hasPerm, isFalse);

      final req = await NabinLocationService.instance.requestPermission();
      expect(req, equals(LocationPermissionStatus.granted)); // Mock grants on request
    });

    test('Handles GPS service disabled state', () async {
      mockSource.serviceEnabled = false;

      final isEnabled = await NabinLocationService.instance.isLocationServiceEnabled();
      expect(isEnabled, isFalse);

      final status = await NabinLocationService.instance.checkPermission();
      expect(status, equals(LocationPermissionStatus.serviceDisabled));

      final pos = await NabinLocationService.instance.getCurrentPosition();
      expect(pos, isNull);
    });

    test('Emits GPS stream positions correctly', () async {
      mockSource.permissionStatus = LocationPermissionStatus.granted;
      mockSource.serviceEnabled = true;

      final stream = NabinLocationService.instance.getPositionStream(
        intervalSeconds: 1,
        distanceFilterMeters: 5,
      );

      final emitted = <LocationPoint>[];
      final sub = stream.listen(emitted.add);

      mockSource.emitPosition(LocationPoint(
        latitude: 23.7280,
        longitude: 92.7180,
        heading: 45.0,
        speed: 10.0,
        accuracy: 5.0,
        timestamp: DateTime.now(),
      ));

      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(emitted.length, equals(1));
      expect(emitted.first.latitude, equals(23.7280));
      await sub.cancel();
    });
  });

  group('Phase 2 — DriverLocationManager (Duty Lifecycle, Throttling & Reconnects)', () {
    late MockLocationSource mockSource;

    setUp(() {
      mockSource = MockLocationSource();
      mockSource.mockCurrentPosition = null;
      NabinLocationService.instance.setSource(mockSource);
      mockSource.permissionStatus = LocationPermissionStatus.granted;
      mockSource.serviceEnabled = true;
      DriverLocationManager.instance.initialize();
      SessionManager.instance.saveSession(
        token: 'test_token',
        user: {'id': 'drv_test_123', 'name': 'Test Driver'},
      );
    });

    tearDown(() {
      DriverLocationManager.instance.dispose();
      NabinLocationService.instance.resetSource();
      SessionManager.instance.clearSession();
    });

    test('Does not track or transmit location when off-duty', () async {
      await DriverLocationManager.instance.setDutyStatus(isOnline: false);
      expect(DriverLocationManager.instance.isTracking, isFalse);
      expect(DriverLocationManager.instance.isOnline, isFalse);

      mockSource.emitPosition(LocationPoint(
        latitude: 23.7271,
        longitude: 92.7176,
        heading: 0,
        speed: 0,
        accuracy: 5,
        timestamp: DateTime.now(),
      ));

      expect(DriverLocationManager.instance.lastKnownLocation, isNull);
    });

    test('Starts tracking and captures location when online', () async {
      mockSource.mockCurrentPosition = LocationPoint(
        latitude: 23.7271,
        longitude: 92.7176,
        heading: 180,
        speed: 5.0,
        accuracy: 10,
        timestamp: DateTime.now(),
      );

      await DriverLocationManager.instance.setDutyStatus(isOnline: true, activeJobId: 'job_456');
      expect(DriverLocationManager.instance.isTracking, isTrue);
      expect(DriverLocationManager.instance.isOnline, isTrue);
      expect(DriverLocationManager.instance.activeJobId, equals('job_456'));

      expect(DriverLocationManager.instance.lastKnownLocation, isNotNull);
      expect(DriverLocationManager.instance.lastKnownLocation!.latitude, equals(23.7271));
    });

    test('Discards stale GPS readings older than 15 seconds', () async {
      await DriverLocationManager.instance.setDutyStatus(isOnline: true);

      final stalePoint = LocationPoint(
        latitude: 23.7300,
        longitude: 92.7200,
        heading: 0,
        speed: 0,
        accuracy: 5,
        timestamp: DateTime.now().subtract(const Duration(seconds: 25)),
      );

      mockSource.emitPosition(stalePoint);
      expect(DriverLocationManager.instance.lastKnownLocation, isNull);
    });

    test('Discards inaccurate GPS readings with accuracy > 100m', () async {
      await DriverLocationManager.instance.setDutyStatus(isOnline: true);

      final inaccuratePoint = LocationPoint(
        latitude: 23.7300,
        longitude: 92.7200,
        heading: 0,
        speed: 0,
        accuracy: 150.0,
        timestamp: DateTime.now(),
      );

      mockSource.emitPosition(inaccuratePoint);
      expect(DriverLocationManager.instance.lastKnownLocation, isNull);
    });

    test('Ceases tracking immediately when switched off-duty', () async {
      await DriverLocationManager.instance.setDutyStatus(isOnline: true);
      expect(DriverLocationManager.instance.isTracking, isTrue);

      await DriverLocationManager.instance.setDutyStatus(isOnline: false);
      expect(DriverLocationManager.instance.isTracking, isFalse);
      expect(DriverLocationManager.instance.isOnline, isFalse);
    });
  });

  group('Phase 4 — NabinRoutingService (Road Routing & Zero Fake Polylines)', () {
    tearDown(() {
      NabinRoutingService.instance.resetSource();
    });

    test('Parses valid OSRM GeoJSON geometry into LatLng list', () async {
      final mockRouting = MockRoutingSource();
      mockRouting.mockResult = RoutingResult.ok([
        const LatLng(23.7271, 92.7176),
        const LatLng(23.7275, 92.7180),
        const LatLng(23.7285, 92.7190),
      ], distanceMeters: 1200, durationSeconds: 180);

      NabinRoutingService.instance.setSource(mockRouting);

      final res = await NabinRoutingService.instance.getRoute(
        start: const LatLng(23.7271, 92.7176),
        end: const LatLng(23.7285, 92.7190),
      );

      expect(res.success, isTrue);
      expect(res.points.length, equals(3));
      expect(res.points[0].latitude, equals(23.7271));
      expect(res.points[0].longitude, equals(92.7176));
      expect(res.points[2].latitude, equals(23.7285));
      expect(res.points[2].longitude, equals(92.7190));
    });

    test('Returns null / error on routing failure without creating straight line', () async {
      final mockRouting = MockRoutingSource();
      mockRouting.mockResult = RoutingResult.error('Routing service unreachable');
      NabinRoutingService.instance.setSource(mockRouting);

      final res = await NabinRoutingService.instance.getRoute(
        start: const LatLng(23.7271, 92.7176),
        end: const LatLng(23.7285, 92.7190),
      );

      // Must fail closed (success == false, empty points) so the UI does NOT render a straight line polyline
      expect(res.success, isFalse);
      expect(res.points, isEmpty);
      expect(res.errorMessage, contains('unreachable'));
    });
  });

  group('Phase 3 & 5 — ActiveTripMapView & Customer Telemetry Badges', () {
    testWidgets('Renders map view with pickup, drop and live driver marker', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ActiveTripMapView(
              pickup: LatLng(23.7271, 92.7176),
              drop: LatLng(23.7350, 92.7250),
              pickupLabel: 'Aizawl Treasury',
              dropLabel: 'Bawngkawn Junction',
              driverLocation: LatLng(23.7290, 92.7190),
              driverHeading: 45.0,
              isSocketConnected: true,
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.byType(ActiveTripMapView), findsOneWidget);
      expect(find.text('Live Driver GPS'), findsOneWidget);
    });

    testWidgets('Displays stale telemetry badge when driver update > 30 seconds old', (tester) async {
      final staleTimestamp = DateTime.now().subtract(const Duration(seconds: 45));

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ActiveTripMapView(
              pickup: const LatLng(23.7271, 92.7176),
              drop: const LatLng(23.7350, 92.7250),
              driverLocation: const LatLng(23.7290, 92.7190),
              driverLocationUpdatedAt: staleTimestamp,
              isSocketConnected: true,
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Driver signal delayed'), findsOneWidget);
    });

    testWidgets('Displays connection warning badge when socket disconnected', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ActiveTripMapView(
              pickup: LatLng(23.7271, 92.7176),
              drop: LatLng(23.7350, 92.7250),
              isSocketConnected: false,
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Reconnecting live GPS…'), findsOneWidget);
    });

    testWidgets('Renders properly when passed GeoCoord domain objects', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ActiveTripMapView(
              pickup: GeoCoord(23.7271, 92.7176),
              drop: GeoCoord(23.7350, 92.7250),
              driverLocation: GeoCoord(23.7290, 92.7190),
              roadRoutePoints: [
                GeoCoord(23.7271, 92.7176),
                GeoCoord(23.7290, 92.7190),
              ],
              isSocketConnected: true,
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.byType(ActiveTripMapView), findsOneWidget);
      expect(find.text('Live Driver GPS'), findsOneWidget);
    });
  });

  group('Provider-Agnostic Architecture (GeoCoord, MapConfig & Google Maps Preparation)', () {
    test('GeoCoord converts accurately to and from latlong2 LatLng and JSON', () {
      const coord = GeoCoord(23.7271, 92.7176);
      expect(coord.latitude, equals(23.7271));
      expect(coord.longitude, equals(92.7176));

      final latLng = coord.toLatLng();
      expect(latLng.latitude, equals(23.7271));
      expect(latLng.longitude, equals(92.7176));

      final fromLatLng = GeoCoord.fromLatLng(latLng);
      expect(fromLatLng, equals(coord));

      final map = coord.toMap();
      final fromMap = GeoCoord.fromMap(map);
      expect(fromMap, equals(coord));

      const nearCoord = GeoCoord(23.7280, 92.7176);
      final dist = coord.distanceTo(nearCoord);
      expect(dist, greaterThan(50));
      expect(dist, lessThan(150));
    });

    test('MapConfig centralizes tile settings and defaults', () {
      expect(MapConfig.activeMapProvider, equals(MapProviderType.flutterMapOsm));
      expect(MapConfig.activeRoutingProvider, equals(RoutingProviderType.osrm));
      expect(MapConfig.tileUrlTemplate, contains('cartocdn.com'));
      expect(MapConfig.tileFallbackUrl, contains('tile.openstreetmap.org'));
      expect(MapConfig.defaultCenter.latitude, equals(23.7271));
      expect(MapConfig.defaultCenter.longitude, equals(92.7176));
      expect(MapConfig.isGoogleMapsConfigured, isFalse);
    });

    test('GoogleDirectionsRoutingSource fails closed safely without API key', () async {
      const googleRouting = GoogleDirectionsRoutingSource(apiKey: null);
      final res = await googleRouting.getRoute(
        start: const GeoCoord(23.7271, 92.7176),
        end: const GeoCoord(23.7350, 92.7250),
      );

      expect(res.success, isFalse);
      expect(res.errorMessage, contains('not configured'));
      expect(res.points, isEmpty);
    });
  });
}

