import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../../core/network/nabin_api_service.dart';
import '../../../core/network/nabin_ws_service.dart';
import '../../../core/network/session_manager.dart';
import '../../../core/services/nabin_location_service.dart';

class DriverLocationManager {
  DriverLocationManager._();
  static final DriverLocationManager instance = DriverLocationManager._();

  StreamSubscription<LocationPoint>? _positionSub;
  StreamSubscription<Map<String, dynamic>>? _authSub;

  bool _isOnline = false;
  String? _activeJobId;
  LocationPoint? _lastReportedLocation;
  DateTime? _lastReportedAt;

  final _locationUpdatesController =
      StreamController<LocationPoint>.broadcast();
  Stream<LocationPoint> get onLocationUpdated =>
      _locationUpdatesController.stream;

  LocationPoint? get lastKnownLocation => _lastReportedLocation;
  bool get isTracking => _positionSub != null;
  bool get isOnline => _isOnline;
  String? get activeJobId => _activeJobId;

  /// Update interval throttle in milliseconds (3 seconds)
  static const int minUpdateIntervalMs = 3000;

  /// Stationary heartbeat interval in milliseconds (15 seconds)
  static const int heartbeatIntervalMs = 15000;

  /// Movement threshold in meters (5 meters)
  static const double minDistanceThresholdMeters = 5.0;

  void initialize() {
    _authSub?.cancel();
    _authSub = NabinWsService.instance.onAuthenticated.listen((_) {
      _handleSocketReconnected();
    });
  }

  void dispose() {
    stopTracking();
    _authSub?.cancel();
    _authSub = null;
    _lastReportedLocation = null;
    _lastReportedAt = null;
    _activeJobId = null;
    _isOnline = false;
  }

  /// Sets driver online/offline duty status.
  /// If set to false, immediately ceases tracking and transmission.
  /// Returns false if starting tracking failed (e.g. permission denied or GPS disabled).
  Future<bool> setDutyStatus({required bool isOnline, String? activeJobId}) async {
    _isOnline = isOnline;
    _activeJobId = activeJobId;

    if (_isOnline) {
      final started = await startTracking();
      if (!started) {
        _isOnline = false;
        return false;
      }
      return true;
    } else {
      stopTracking();
      return true;
    }
  }

  /// Sets or updates the active assigned job ID for telemetry attribution.
  void setActiveJob(String? jobId) {
    _activeJobId = jobId;
    if (_lastReportedLocation != null && _isOnline) {
      // Force an immediate update to attach the job ID
      _transmitLocation(_lastReportedLocation!, force: true);
    }
  }

  /// Starts listening to device GPS and transmitting location.
  Future<bool> startTracking() async {
    if (_positionSub != null) return true;
    if (!_isOnline) return false;

    final hasPerm = await NabinLocationService.instance.hasPermission();
    if (!hasPerm) {
      final req = await NabinLocationService.instance.requestPermission();
      if (req != LocationPermissionStatus.granted) {
        debugPrint('[DriverLocationManager] Location permission denied: $req');
        return false;
      }
    }

    // Capture initial location immediately
    final initialPos =
        await NabinLocationService.instance.getCurrentPosition();
    if (initialPos != null) {
      _handleNewLocation(initialPos);
    }

    _positionSub = NabinLocationService.instance
        .getPositionStream(
          intervalSeconds: 3,
          distanceFilterMeters: minDistanceThresholdMeters,
          enableForegroundNotification: true,
        )
        .listen(
          (point) => _handleNewLocation(point),
          onError: (err) {
            debugPrint('[DriverLocationManager] GPS stream error: $err');
          },
        );

    return true;
  }

  /// Stops tracking and cancels GPS stream. Zero location transmitted while stopped.
  void stopTracking() {
    _positionSub?.cancel();
    _positionSub = null;
  }

  void _handleNewLocation(LocationPoint point) {
    if (!_isOnline) return;

    // Discard stale readings (> 15 seconds old)
    final ageMs = DateTime.now().difference(point.timestamp).inMilliseconds;
    if (ageMs > 15000) {
      debugPrint('[DriverLocationManager] Discarding stale GPS point ($ageMs ms old)');
      return;
    }

    // Discard inaccurate readings (> 100 meters error)
    if (point.accuracy > 100.0) {
      debugPrint('[DriverLocationManager] Discarding inaccurate GPS point (accuracy ${point.accuracy}m)');
      return;
    }

    _locationUpdatesController.add(point);
    _transmitLocation(point);
  }

  void _transmitLocation(LocationPoint point, {bool force = false}) {
    final driverId = SessionManager.instance.currentUser?['id']?.toString();
    if (driverId == null || driverId.isEmpty) {
      debugPrint('[DriverLocationManager] Unauthenticated: Skipping location transmission.');
      return;
    }

    final now = DateTime.now();
    if (!force && _lastReportedAt != null && _lastReportedLocation != null) {
      final elapsedMs = now.difference(_lastReportedAt!).inMilliseconds;
      if (elapsedMs < minUpdateIntervalMs) {
        // Throttled: faster than minimum update interval
        return;
      }

      final dist = _approxDistanceMeters(
        _lastReportedLocation!.latitude,
        _lastReportedLocation!.longitude,
        point.latitude,
        point.longitude,
      );

      if (dist < minDistanceThresholdMeters && elapsedMs < heartbeatIntervalMs) {
        // Stationary and within heartbeat window: skip redundant write
        return;
      }
    }

    _lastReportedLocation = point;
    _lastReportedAt = now;

    // 1. Primary: Transmit over WebSocket if connected
    if (NabinWsService.instance.isConnected &&
        NabinWsService.instance.isAuthenticated) {
      NabinWsService.instance.sendDriverLocation(
        driverId: driverId,
        latitude: point.latitude,
        longitude: point.longitude,
        bearing: point.heading,
        speed: point.speed,
        activeJobId: _activeJobId,
      );
    } else {
      // 2. Fallback: Transmit over authenticated HTTP endpoint
      NabinApiService.postDriverLocation(
        lat: point.latitude,
        lng: point.longitude,
        heading: point.heading,
        speed: point.speed,
        accuracy: point.accuracy,
        jobId: _activeJobId,
      ).catchError((_) => null);
    }
  }

  void _handleSocketReconnected() {
    if (_isOnline && _lastReportedLocation != null) {
      debugPrint('[DriverLocationManager] WebSocket reconnected: Flushing current location.');
      _transmitLocation(_lastReportedLocation!, force: true);
    }
  }

  double _approxDistanceMeters(
      double lat1, double lon1, double lat2, double lon2) {
    const double p = 0.017453292519943295; // Math.PI / 180
    final double a = 0.5 -
        ((lat2 - lat1) * p / 2).abs() *
            ((lat2 - lat1) * p / 2).abs() +
        ((lat1 * p).abs()) *
            ((lat2 * p).abs()) *
            (1 - ((lon2 - lon1) * p / 2).abs());
    return 12742000 * a; // 2 * R * 1000m
  }
}
