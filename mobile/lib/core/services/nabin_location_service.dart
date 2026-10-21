import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

enum LocationPermissionStatus {
  granted,
  denied,
  deniedForever,
  serviceDisabled,
}

class LocationPoint {
  final double latitude;
  final double longitude;
  final double heading;
  final double speed;
  final double accuracy;
  final DateTime timestamp;

  const LocationPoint({
    required this.latitude,
    required this.longitude,
    this.heading = 0.0,
    this.speed = 0.0,
    this.accuracy = 0.0,
    required this.timestamp,
  });

  Map<String, dynamic> toMap() => {
        'latitude': latitude,
        'longitude': longitude,
        'heading': heading,
        'speed': speed,
        'accuracy': accuracy,
        'timestamp': timestamp.toIso8601String(),
      };

  @override
  String toString() =>
      'LocationPoint(lat: ${latitude.toStringAsFixed(5)}, lng: ${longitude.toStringAsFixed(5)}, heading: ${heading.toStringAsFixed(1)}, speed: ${speed.toStringAsFixed(1)} m/s)';
}

abstract class LocationPlatformSource {
  Future<bool> isLocationServiceEnabled();
  Future<LocationPermissionStatus> checkPermission();
  Future<LocationPermissionStatus> requestPermission();
  Future<LocationPoint?> getCurrentPosition();
  Stream<LocationPoint> getPositionStream({
    int intervalSeconds = 3,
    double distanceFilterMeters = 5.0,
    bool enableForegroundNotification = false,
  });
}

class GeolocatorLocationSource implements LocationPlatformSource {
  @override
  Future<bool> isLocationServiceEnabled() async {
    try {
      return await Geolocator.isLocationServiceEnabled();
    } catch (_) {
      return false;
    }
  }

  @override
  Future<LocationPermissionStatus> checkPermission() async {
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) return LocationPermissionStatus.serviceDisabled;

      final perm = await Geolocator.checkPermission();
      return _mapPermission(perm);
    } catch (_) {
      return LocationPermissionStatus.denied;
    }
  }

  @override
  Future<LocationPermissionStatus> requestPermission() async {
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) return LocationPermissionStatus.serviceDisabled;

      final perm = await Geolocator.requestPermission();
      return _mapPermission(perm);
    } catch (_) {
      return LocationPermissionStatus.denied;
    }
  }

  LocationPermissionStatus _mapPermission(LocationPermission perm) {
    switch (perm) {
      case LocationPermission.always:
      case LocationPermission.whileInUse:
        return LocationPermissionStatus.granted;
      case LocationPermission.deniedForever:
        return LocationPermissionStatus.deniedForever;
      case LocationPermission.denied:
      case LocationPermission.unableToDetermine:
        return LocationPermissionStatus.denied;
    }
  }

  @override
  Future<LocationPoint?> getCurrentPosition() async {
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
      return LocationPoint(
        latitude: pos.latitude,
        longitude: pos.longitude,
        heading: pos.heading,
        speed: pos.speed,
        accuracy: pos.accuracy,
        timestamp: pos.timestamp,
      );
    } catch (e) {
      debugPrint('[NabinLocationService] Error getting current position: $e');
      return null;
    }
  }

  @override
  Stream<LocationPoint> getPositionStream({
    int intervalSeconds = 3,
    double distanceFilterMeters = 5.0,
    bool enableForegroundNotification = false,
  }) {
    final LocationSettings locationSettings;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android && enableForegroundNotification) {
      locationSettings = AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilterMeters.toInt(),
        intervalDuration: Duration(seconds: intervalSeconds),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'NABIN Driver Online',
          notificationText: 'Sharing live location for active ride dispatch and passenger safety.',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    } else {
      locationSettings = LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilterMeters.toInt(),
      );
    }

    return Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).map(
      (pos) => LocationPoint(
        latitude: pos.latitude,
        longitude: pos.longitude,
        heading: pos.heading,
        speed: pos.speed,
        accuracy: pos.accuracy,
        timestamp: pos.timestamp,
      ),
    );
  }
}

class MockLocationSource implements LocationPlatformSource {
  bool serviceEnabled = true;
  LocationPermissionStatus permissionStatus = LocationPermissionStatus.granted;
  LocationPoint? mockCurrentPosition;
  final StreamController<LocationPoint> _streamController =
      StreamController<LocationPoint>.broadcast();

  void emitPosition(LocationPoint point) {
    _streamController.add(point);
  }

  @override
  Future<bool> isLocationServiceEnabled() async => serviceEnabled;

  @override
  Future<LocationPermissionStatus> checkPermission() async =>
      serviceEnabled ? permissionStatus : LocationPermissionStatus.serviceDisabled;

  @override
  Future<LocationPermissionStatus> requestPermission() async {
    if (!serviceEnabled) return LocationPermissionStatus.serviceDisabled;
    if (permissionStatus == LocationPermissionStatus.denied) {
      permissionStatus = LocationPermissionStatus.granted;
    }
    return permissionStatus;
  }

  @override
  Future<LocationPoint?> getCurrentPosition() async => mockCurrentPosition;

  @override
  Stream<LocationPoint> getPositionStream({
    int intervalSeconds = 3,
    double distanceFilterMeters = 5.0,
    bool enableForegroundNotification = false,
  }) =>
      _streamController.stream;
}

class NabinLocationService {
  NabinLocationService._();
  static final NabinLocationService instance = NabinLocationService._();

  LocationPlatformSource _source = GeolocatorLocationSource();

  @visibleForTesting
  void setSource(LocationPlatformSource source) {
    _source = source;
  }

  @visibleForTesting
  void resetSource() {
    _source = GeolocatorLocationSource();
  }

  Future<bool> isLocationServiceEnabled() => _source.isLocationServiceEnabled();

  Future<LocationPermissionStatus> checkPermission() => _source.checkPermission();

  Future<LocationPermissionStatus> requestPermission() =>
      _source.requestPermission();

  Future<bool> hasPermission() async {
    final status = await checkPermission();
    return status == LocationPermissionStatus.granted;
  }

  Future<LocationPoint?> getCurrentPosition() => _source.getCurrentPosition();

  Stream<LocationPoint> getPositionStream({
    int intervalSeconds = 3,
    double distanceFilterMeters = 5.0,
    bool enableForegroundNotification = false,
  }) =>
      _source.getPositionStream(
        intervalSeconds: intervalSeconds,
        distanceFilterMeters: distanceFilterMeters,
        enableForegroundNotification: enableForegroundNotification,
      );
}
