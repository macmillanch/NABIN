import '../models/geo_coord.dart';

/// Supported map rendering engines across NABIN.
enum MapProviderType {
  /// OpenStreetMap / CARTO raster tiles via FlutterMap (default, zero cost).
  flutterMapOsm,

  /// Native Google Maps SDK via `google_maps_flutter` (future extension).
  googleMaps,
}

/// Supported road routing calculation services.
enum RoutingProviderType {
  /// Open Source Routing Machine (OSRM) driving route engine (default).
  osrm,

  /// Google Directions API route calculation engine (future extension).
  googleDirections,
}

/// Central configuration for all map rendering and routing across NABIN.
///
/// Prevents hardcoding tile URLs, subdomains, and provider endpoints across screens.
/// Enables future zero-downtime switching to Google Maps without altering booking,
/// GPS acquisition, driver dispatch, or WebSocket telemetry layers.
class MapConfig {
  MapConfig._();

  /// The active map rendering engine.
  static MapProviderType activeMapProvider = MapProviderType.flutterMapOsm;

  /// The active routing calculation engine.
  static RoutingProviderType activeRoutingProvider = RoutingProviderType.osrm;

  /// Primary CARTO Voyager Retina tile layer template.
  static String tileUrlTemplate =
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png';

  /// Standard OpenStreetMap fallback tile layer template.
  static String tileFallbackUrl =
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  /// Subdomains for tile load balancing.
  static List<String> tileSubdomains = const ['a', 'b', 'c', 'd'];

  /// User agent package identifier sent with tile HTTP requests.
  static String userAgentPackageName = 'com.nabin.mobile';

  /// Default map center: Aizawl, Mizoram (lat 23.7271, lng 92.7176).
  static GeoCoord defaultCenter = const GeoCoord(23.7271, 92.7176);

  /// Default initial zoom level for overview maps.
  static double defaultZoom = 14.5;

  /// OSRM base URL for road routing requests.
  static String osrmBaseUrl = 'https://router.project-osrm.org';

  /// Google Maps API key (null by default; populated via environment/secure config when enabled).
  static String? googleMapsApiKey;

  /// Whether Google Maps integration has an API key configured.
  static bool get isGoogleMapsConfigured =>
      googleMapsApiKey != null && googleMapsApiKey!.trim().isNotEmpty;

  /// Resets configuration to default OpenStreetMap / OSRM values (useful for tests).
  static void resetToDefaults() {
    activeMapProvider = MapProviderType.flutterMapOsm;
    activeRoutingProvider = RoutingProviderType.osrm;
    tileUrlTemplate =
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png';
    tileFallbackUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    tileSubdomains = const ['a', 'b', 'c', 'd'];
    userAgentPackageName = 'com.nabin.mobile';
    defaultCenter = const GeoCoord(23.7271, 92.7176);
    defaultZoom = 14.5;
    osrmBaseUrl = 'https://router.project-osrm.org';
    googleMapsApiKey = null;
  }
}
