import 'dart:math' as math;
import 'package:latlong2/latlong.dart' as latlong2;

/// Provider-neutral geographic coordinate representation.
///
/// Decouples all business logic, booking workflows, driver dispatch,
/// and telemetry from specific map libraries (e.g. `latlong2`, Google Maps `LatLng`).
class GeoCoord {
  final double latitude;
  final double longitude;

  const GeoCoord(this.latitude, this.longitude);

  /// Creates a GeoCoord from a map representation (e.g. JSON or DB row).
  factory GeoCoord.fromMap(Map<String, dynamic> map) {
    final lat = map['lat'] ?? map['latitude'];
    final lng = map['lng'] ?? map['longitude'] ?? map['lon'];
    return GeoCoord(
      (lat is num) ? lat.toDouble() : double.parse(lat.toString()),
      (lng is num) ? lng.toDouble() : double.parse(lng.toString()),
    );
  }

  /// Converts this coordinate to a standard JSON map.
  Map<String, double> toMap() => {
        'latitude': latitude,
        'longitude': longitude,
      };

  /// Converts this coordinate to a latlong2 LatLng instance for FlutterMap.
  latlong2.LatLng toLatLng() => latlong2.LatLng(latitude, longitude);

  /// Creates a GeoCoord from a latlong2 LatLng instance.
  static GeoCoord fromLatLng(latlong2.LatLng latLng) =>
      GeoCoord(latLng.latitude, latLng.longitude);

  /// Approximate distance to another coordinate in meters using the Haversine formula.
  double distanceTo(GeoCoord other) {
    const double p = math.pi / 180;
    final double dLat = (other.latitude - latitude) * p;
    final double dLon = (other.longitude - longitude) * p;
    final double a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(latitude * p) *
            math.cos(other.latitude * p) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    final double c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return 6371000 * c; // Earth radius in meters
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is GeoCoord &&
          runtimeType == other.runtimeType &&
          (latitude - other.latitude).abs() < 0.000001 &&
          (longitude - other.longitude).abs() < 0.000001;

  @override
  int get hashCode =>
      (latitude * 1000000).round().hashCode ^
      (longitude * 1000000).round().hashCode;

  @override
  String toString() =>
      'GeoCoord(${latitude.toStringAsFixed(5)}, ${longitude.toStringAsFixed(5)})';
}
