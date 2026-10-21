import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import '../config/map_config.dart';
import '../models/geo_coord.dart';

class RoutingResult {
  final bool success;
  final List<GeoCoord> coords;
  final double distanceMeters;
  final double durationSeconds;
  final String? errorMessage;

  const RoutingResult({
    required this.success,
    this.coords = const [],
    this.distanceMeters = 0.0,
    this.durationSeconds = 0.0,
    this.errorMessage,
  });

  /// Compatibility getter returning latlong2 LatLng instances for FlutterMap.
  List<LatLng> get points => coords.map((c) => c.toLatLng()).toList();

  factory RoutingResult.ok(
    dynamic pointsOrCoords, {
    double distanceMeters = 0.0,
    double durationSeconds = 0.0,
  }) {
    final List<GeoCoord> resolvedCoords;
    if (pointsOrCoords is List<GeoCoord>) {
      resolvedCoords = pointsOrCoords;
    } else if (pointsOrCoords is List<LatLng>) {
      resolvedCoords =
          pointsOrCoords.map((pt) => GeoCoord(pt.latitude, pt.longitude)).toList();
    } else if (pointsOrCoords is List) {
      resolvedCoords = pointsOrCoords.map((pt) {
        if (pt is GeoCoord) return pt;
        if (pt is LatLng) return GeoCoord(pt.latitude, pt.longitude);
        return GeoCoord.fromMap(pt as Map<String, dynamic>);
      }).toList();
    } else {
      resolvedCoords = const [];
    }

    return RoutingResult(
      success: true,
      coords: resolvedCoords,
      distanceMeters: distanceMeters,
      durationSeconds: durationSeconds,
    );
  }

  factory RoutingResult.error(String message) => RoutingResult(
        success: false,
        errorMessage: message,
      );
}

abstract class RoutingPlatformSource {
  Future<RoutingResult> getRoute({
    required GeoCoord start,
    required GeoCoord end,
  });
}

/// Open Source Routing Machine (OSRM) client.
/// Uses the configured `MapConfig.osrmBaseUrl` with support for custom self-hosted OSRM instances.
class OsrmRoutingSource implements RoutingPlatformSource {
  final http.Client? client;
  final String? baseUrl;

  const OsrmRoutingSource({
    this.client,
    this.baseUrl,
  });

  @override
  Future<RoutingResult> getRoute({
    required GeoCoord start,
    required GeoCoord end,
  }) async {
    final effectiveClient = client ?? http.Client();
    final effectiveBase = baseUrl ?? MapConfig.osrmBaseUrl;
    final url = Uri.parse(
      '$effectiveBase/route/v1/driving/'
      '${start.longitude},${start.latitude};'
      '${end.longitude},${end.latitude}'
      '?overview=full&geometries=geojson',
    );

    try {
      final response = await effectiveClient
          .get(url, headers: {'User-Agent': 'NABIN-Mobile-Routing/1.0'})
          .timeout(const Duration(seconds: 6));

      if (response.statusCode != 200) {
        return RoutingResult.error(
          'Routing service error: HTTP ${response.statusCode}',
        );
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (data['code'] != 'Ok') {
        return RoutingResult.error(
          'Routing calculation failed: ${data['code'] ?? 'Unknown error'}',
        );
      }

      final routes = data['routes'] as List?;
      if (routes == null || routes.isEmpty) {
        return RoutingResult.error('No road routes found between coordinates.');
      }

      final primary = routes[0] as Map<String, dynamic>;
      final geometry = primary['geometry'] as Map<String, dynamic>?;
      final coords = geometry?['coordinates'] as List?;

      if (coords == null || coords.isEmpty) {
        return RoutingResult.error('Empty route geometry received.');
      }

      final points = <GeoCoord>[];
      for (final pt in coords) {
        if (pt is List && pt.length >= 2) {
          final lon = (pt[0] as num).toDouble();
          final lat = (pt[1] as num).toDouble();
          points.add(GeoCoord(lat, lon));
        }
      }

      final distance = (primary['distance'] as num?)?.toDouble() ?? 0.0;
      final duration = (primary['duration'] as num?)?.toDouble() ?? 0.0;

      return RoutingResult.ok(
        points,
        distanceMeters: distance,
        durationSeconds: duration,
      );
    } catch (e) {
      debugPrint('[NabinRoutingService] Routing request error: $e');
      return RoutingResult.error('Routing service unreachable: $e');
    } finally {
      if (client == null) {
        effectiveClient.close();
      }
    }
  }
}

/// Provider-neutral adapter for Google Directions REST API.
///
/// Activated when `MapConfig.activeRoutingProvider == RoutingProviderType.googleDirections`.
/// Requires a valid Google Maps API Key. Fails closed safely if unconfigured.
class GoogleDirectionsRoutingSource implements RoutingPlatformSource {
  final http.Client? client;
  final String? apiKey;

  const GoogleDirectionsRoutingSource({
    this.client,
    this.apiKey,
  });

  @override
  Future<RoutingResult> getRoute({
    required GeoCoord start,
    required GeoCoord end,
  }) async {
    final effectiveKey = apiKey ?? MapConfig.googleMapsApiKey;
    if (effectiveKey == null || effectiveKey.trim().isEmpty) {
      return RoutingResult.error(
        'Google Directions API key is not configured. Set MapConfig.googleMapsApiKey before use.',
      );
    }

    final effectiveClient = client ?? http.Client();
    final url = Uri.parse(
      'https://maps.googleapis.com/maps/api/directions/json'
      '?origin=${start.latitude},${start.longitude}'
      '&destination=${end.latitude},${end.longitude}'
      '&mode=driving'
      '&key=$effectiveKey',
    );

    try {
      final response = await effectiveClient
          .get(url, headers: {'User-Agent': 'NABIN-Mobile-Routing/1.0'})
          .timeout(const Duration(seconds: 8));

      if (response.statusCode != 200) {
        return RoutingResult.error(
          'Google Directions HTTP ${response.statusCode}',
        );
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final status = data['status'] as String? ?? 'UNKNOWN';
      if (status != 'OK') {
        return RoutingResult.error(
          'Google Directions error: $status (${data['error_message'] ?? 'No route'})',
        );
      }

      final routes = data['routes'] as List?;
      if (routes == null || routes.isEmpty) {
        return RoutingResult.error('No routes found.');
      }

      final overviewPolyline =
          routes[0]['overview_polyline']?['points'] as String?;
      if (overviewPolyline == null || overviewPolyline.isEmpty) {
        return RoutingResult.error('Empty overview polyline.');
      }

      final decodedCoords = _decodePolyline(overviewPolyline);
      final legs = routes[0]['legs'] as List?;
      final distance = (legs != null && legs.isNotEmpty)
          ? (legs[0]['distance']?['value'] as num?)?.toDouble() ?? 0.0
          : 0.0;
      final duration = (legs != null && legs.isNotEmpty)
          ? (legs[0]['duration']?['value'] as num?)?.toDouble() ?? 0.0
          : 0.0;

      return RoutingResult.ok(
        decodedCoords,
        distanceMeters: distance,
        durationSeconds: duration,
      );
    } catch (e) {
      return RoutingResult.error('Google Directions unreachable: $e');
    } finally {
      if (client == null) {
        effectiveClient.close();
      }
    }
  }

  /// Decodes Google's Encoded Polyline Algorithm Format to GeoCoord points.
  static List<GeoCoord> _decodePolyline(String encoded) {
    final List<GeoCoord> points = [];
    int index = 0, len = encoded.length;
    int lat = 0, lng = 0;

    while (index < len) {
      int b, shift = 0, result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      int dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      int dlng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
      lng += dlng;

      points.add(GeoCoord(lat / 1E5, lng / 1E5));
    }
    return points;
  }
}

class MockRoutingSource implements RoutingPlatformSource {
  RoutingResult? mockResult;

  @override
  Future<RoutingResult> getRoute({
    required GeoCoord start,
    required GeoCoord end,
  }) async {
    return mockResult ??
        RoutingResult.ok([start, end], distanceMeters: 1000, durationSeconds: 120);
  }
}

class NabinRoutingService {
  NabinRoutingService._();
  static final NabinRoutingService instance = NabinRoutingService._();

  RoutingPlatformSource _source = const OsrmRoutingSource();

  @visibleForTesting
  void setSource(RoutingPlatformSource source) {
    _source = source;
  }

  @visibleForTesting
  void resetSource() {
    _source = const OsrmRoutingSource();
  }

  /// Calculates road route between two points.
  /// Accepts either [GeoCoord] or `latlong2.LatLng` instances.
  Future<RoutingResult> getRoute({
    required dynamic start,
    required dynamic end,
  }) {
    final GeoCoord startCoord = start is GeoCoord
        ? start
        : (start is LatLng
            ? GeoCoord(start.latitude, start.longitude)
            : GeoCoord.fromMap(start as Map<String, dynamic>));

    final GeoCoord endCoord = end is GeoCoord
        ? end
        : (end is LatLng
            ? GeoCoord(end.latitude, end.longitude)
            : GeoCoord.fromMap(end as Map<String, dynamic>));

    return _source.getRoute(start: startCoord, end: endCoord);
  }
}
