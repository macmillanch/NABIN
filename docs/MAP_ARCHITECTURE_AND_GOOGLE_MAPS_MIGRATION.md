# NABIN — Map Architecture & Google Maps Migration Blueprint

**Author**: System Architect & Mobile App Specialist  
**Status**: Architecture Decoupled / Migration-Ready (Zero-Downtime Blueprint)  
**Date**: October 2026  
**Primary Boundary**: Flutter Mobile (`mobile`), Web Dashboards, Shared Backend (`backend`)

---

## 1. Executive Summary & Goals

The NABIN platform previously relied on tight coupling between map widgets and OpenStreetMap / FlutterMap / `latlong2` primitives. Tile server URLs were scattered across presentation screens, coordinates were stored directly as `latlong2.LatLng`, and routing logic was hardwired directly to OSRM endpoints.

This architecture decouples the mapping subsystems into cleanly isolated tiers:
1. **Core Domain Coordinate Model** (`GeoCoord`) — pure Dart value object, independent of UI or map SDKs.
2. **Centralized Configuration** (`MapConfig`) — unified tile templates, subdomains, retina support, default fallbacks, and runtime provider selection.
3. **Pluggable Routing Layer** (`NabinRoutingService` & `RoutingPlatformSource`) — modular adapters for OSRM, Google Directions, or custom graph routers.
4. **Decoupled Map Rendering** (`ActiveTripMapView`) — presentation abstraction capable of hosting FlutterMap/OSM, Google Maps, or web canvas renderers without touching business state.
5. **Independent Telemetry & GPS** (`NabinLocationService`, `DriverLocationManager`, `DriverLocationChannel`) — sensor acquisition and WebSocket transmission operate purely on domain models (`GeoCoord`, latitude/longitude, speed, heading).

This design ensures that **Google Maps can be added later without rewriting the booking engine, GPS acquisition, driver tracking pipelines, or backend systems**.

---

## 2. Decoupled Architecture Topology

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                           NABIN CORE DOMAIN TIER                            │
 │                                                                             │
 │    ┌─────────────────────────┐             ┌─────────────────────────┐      │
 │    │    GeoCoord (Domain)    │             │   MapConfig (Settings)  │      │
 │    │  - latitude, longitude  │             │  - activeMapProvider    │      │
 │    │  - distanceTo (Haversine│             │  - activeRoutingProvider│      │
 │    │  - toMap() / fromMap()  │             │  - tileUrlTemplate      │      │
 │    └────────────┬────────────┘             └────────────┬────────────┘      │
 └─────────────────┼───────────────────────────────────────┼───────────────────┘
                   │                                       │
        ┌──────────┴──────────────┬────────────────────────┴─────────┐
        ▼                         ▼                                  ▼
 ┌───────────────┐        ┌───────────────┐                  ┌───────────────┐
 │ GPS & SENSORS │        │ ROUTING TIER  │                  │ MAP RENDERING │
 ├───────────────┤        ├───────────────┤                  ├───────────────┤
 │NabinLocation  │        │NabinRouting   │                  │ActiveTripMap  │
 │  Service      │        │  Service      │                  │  View Widget  │
 │  (geolocator) │        │  (Router)     │                  │ (Renderer)    │
 └───────┬───────┘        └───────┬───────┘                  └───────┬───────┘
         │                        │                                  │
         │ Emits GeoCoord         │ Ingests GeoCoord                 │ Accepts GeoCoord
         ▼                        ▼                                  ▼
 ┌───────────────┐        ┌───────────────┐                  ┌───────────────┐
 │DriverLocation │        │RoutingSources:│                  │Renderers:     │
 │  Manager      │        │ - OsrmSource  │                  │ - FlutterMap  │
 │  (Throttling, │        │ - GoogleDirect│                  │   (OSM/Carto) │
 │   Deadband)   │        │   ionsSource  │                  │ - GoogleMaps  │
 └───────┬───────┘        └───────────────┘                  │   (Future)    │
         │                                                   └───────────────┘
         ▼
 ┌───────────────┐
 │WebSocket / WSS│
 │sendDriver     │
 │  Location()   │
 └───────────────┘
```

---

## 3. Existing Decoupled Components

### 3.1 Domain Model: `GeoCoord`
- **File**: `mobile/lib/core/models/geo_coord.dart`
- **Responsibilities**:
  - Implements lightweight, immutable `(double latitude, double longitude)`.
  - Precision conversion helpers: `toMap()`, `fromMap()`, `toLatLng()`, `fromLatLng()`.
  - High-precision geodesic distance calculation via Haversine formula ($R = 6,371,000\text{ m}$), eliminating binary floating-point drift or flat-earth distortion.
  - Zero dependencies on `flutter_map`, `google_maps_flutter`, or platform channels.

### 3.2 Central Configuration: `MapConfig`
- **File**: `mobile/lib/core/config/map_config.dart`
- **Responsibilities**:
  - `MapProviderType { flutterMapOsm, googleMaps }` enum.
  - `RoutingProviderType { osrm, googleDirections }` enum.
  - CARTO Voyager retina vector/raster tile URLs with automatic high-DPI scaling.
  - OpenStreetMap standard raster fallback URL template.
  - Centralized default map center (`GeoCoord(23.7271, 92.7176)` for Aizawl, Mizoram) and zoom levels (`14.5`).
  - Google Maps API key slot (`googleMapsApiKey`), isolated and unpopulated until approved.

### 3.3 Routing Abstraction: `NabinRoutingService`
- **File**: `mobile/lib/core/services/nabin_routing_service.dart`
- **Responsibilities**:
  - `RoutingPlatformSource` interface defining `Future<RoutingResult> fetchRoute({origin, destination})`.
  - `OsrmRoutingSource`: Free, open-source routing via Open Source Routing Machine GeoJSON API.
  - `GoogleDirectionsRoutingSource`: Implemented and ready for activation; includes polyline decoders and fail-closed validation if `MapConfig.googleMapsApiKey` is missing.
  - `RoutingResult`: Stores `List<GeoCoord> coords` natively, with backwards-compatible `List<LatLng> get points`.

### 3.4 Decoupled Rendering: `ActiveTripMapView`
- **File**: `mobile/lib/core/widgets/active_trip_map_view.dart`
- **Responsibilities**:
  - Consumes `GeoCoord pickupCoord`, `GeoCoord destinationCoord`, and `GeoCoord? driverCoord` (or backwards-compatible `LatLng`).
  - Automatically dispatches between `_buildFlutterMapOsm()` and `_buildGoogleMapsPlaceholder()`.
  - When `MapConfig.activeMapProvider == MapProviderType.googleMaps`, renders an informative native placeholder until the Google Maps Flutter SDK is linked.

---

## 4. Google Maps Integration Roadmap

When business and technical approval is granted to integrate Google Maps, follow this exact step-by-step procedure.

### Step 1: Add Flutter Dependencies
In `mobile/pubspec.yaml`, add:
```yaml
dependencies:
  google_maps_flutter: ^2.9.0
  google_maps_flutter_web: ^0.5.8 # For web support
```
Run `flutter pub get`.

### Step 2: Android Platform Configuration
1. **Manifest Permissions & Metadata** (`mobile/android/app/src/main/AndroidManifest.xml`):
   ```xml
   <manifest ...>
       <application ...>
           <!-- Google Maps Android API Key -->
           <meta-data
               android:name="com.google.android.geo.API_KEY"
               android:value="@string/google_maps_key" />
       </application>
   </manifest>
   ```
2. **Key Storage**: Store the key securely in `android/app/src/main/res/values/strings.xml` or inject via CI/CD `local.properties` rather than hardcoding in Git.
3. **Google Play Services**: Verify `minSdkVersion` in `android/app/build.gradle` is $\ge 21$.

### Step 3: iOS Platform Configuration
1. **App Delegate** (`mobile/ios/Runner/AppDelegate.swift`):
   ```swift
   import UIKit
   import Flutter
   import GoogleMaps

   @UIApplicationMain
   @objc class AppDelegate: FlutterAppDelegate {
     override func application(
       _ application: UIApplication,
       didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
     ) -> Bool {
       GMSServices.provideAPIKey("YOUR_IOS_GOOGLE_MAPS_KEY")
       GeneratedPluginRegistrant.register(with: self)
       return super.application(application, didFinishLaunchingWithOptions: launchOptions)
     }
   }
   ```
2. **Podfile**: Run `pod install` in `mobile/ios`. Minimum deployment target must be iOS 14.0 or higher.

### Step 4: Web Application Configuration
For the Flutter Web build or standalone HTML/JS web apps (`apps/customer`, `apps/admin`):
1. **Flutter Web (`mobile/web/index.html`)**:
   Add the Google Maps JavaScript SDK before the Flutter bootstrap script:
   ```html
   <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_WEB_API_KEY&libraries=geometry,places"></script>
   ```
2. **Leaflet Web Apps (`apps/` web dashboards)**:
   - For web apps currently using Leaflet + OpenStreetMap tiles, Google Maps tiles cannot be loaded directly as standard XYZ tile layers due to Google Maps Platform Terms of Service.
   - Use either the official `@googlemaps/js-api-loader` or a Google Maps Leaflet plugin (e.g. `leaflet.gridlayer.googlemutant`) that renders Google Maps through the official JavaScript API canvas.

### Step 5: Enable Google Maps in `ActiveTripMapView`
In `mobile/lib/core/widgets/active_trip_map_view.dart`:
Replace `_buildGoogleMapsPlaceholder()` with the actual `GoogleMap` widget:
```dart
Widget _buildGoogleMapsRenderer(BuildContext context) {
  final markers = <Marker>{
    Marker(
      markerId: const MarkerId('pickup'),
      position: gmaps.LatLng(_pickup.latitude, _pickup.longitude),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.HUE_GREEN),
    ),
    Marker(
      markerId: const MarkerId('destination'),
      position: gmaps.LatLng(_destination.latitude, _destination.longitude),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.HUE_RED),
    ),
  };

  if (_driver != null) {
    markers.add(Marker(
      markerId: const MarkerId('driver'),
      position: gmaps.LatLng(_driver!.latitude, _driver!.longitude),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.HUE_AZURE),
      rotation: widget.driverHeading ?? 0.0,
    ));
  }

  return GoogleMap(
    initialCameraPosition: CameraPosition(
      target: gmaps.LatLng(_pickup.latitude, _pickup.longitude),
      zoom: 14.5,
    ),
    markers: markers,
    polylines: widget.routePoints.isNotEmpty ? {
      Polyline(
        polylineId: const PolylineId('trip_route'),
        points: widget.routePoints.map((c) => gmaps.LatLng(c.latitude, c.longitude)).toList(),
        color: const Color(0xFF1E3A8A),
        width: 5,
      ),
    } : {},
  );
}
```

### Step 6: Toggle Runtime Configuration
In `mobile/lib/core/config/map_config.dart`, update:
```dart
static MapProviderType activeMapProvider = MapProviderType.googleMaps;
static RoutingProviderType activeRoutingProvider = RoutingProviderType.googleDirections;
static String? googleMapsApiKey = const String.fromEnvironment('GOOGLE_MAPS_API_KEY');
```

---

## 5. File Change Matrix When Migrating

The table below lists all files that would be modified, added, or kept untouched when Google Maps is introduced:

| File / Component | Action | Details |
|---|---|---|
| `mobile/lib/core/models/geo_coord.dart` | **Untouched** | Pure domain model remains the single source of truth. |
| `mobile/lib/core/services/nabin_location_service.dart` | **Untouched** | GPS acquisition and permission checks do not depend on map rendering. |
| `mobile/lib/core/services/driver_location_manager.dart` | **Untouched** | Driver telemetry, deadband filtering, and duty state remain unchanged. |
| `mobile/lib/core/services/driver_location_channel.dart` | **Untouched** | WebSocket protocol sends raw `{lat, lng, heading, speed}` JSON. |
| `backend/src/routes/ride.js` & WebSocket server | **Untouched** | Backend operates purely on WGS-84 decimal coordinates. |
| `mobile/pubspec.yaml` | **Modify** | Add `google_maps_flutter` package. |
| `mobile/android/app/src/main/AndroidManifest.xml` | **Modify** | Add Google Maps API key meta-data tag. |
| `mobile/ios/Runner/AppDelegate.swift` | **Modify** | Initialize `GMSServices.provideAPIKey()`. |
| `mobile/web/index.html` | **Modify** | Add Google Maps JavaScript bootstrap script. |
| `mobile/lib/core/config/map_config.dart` | **Modify** | Toggle `activeMapProvider = MapProviderType.googleMaps`. |
| `mobile/lib/core/widgets/active_trip_map_view.dart` | **Modify** | Replace placeholder with `GoogleMap` widget implementation. |

---

## 6. Financial & Governance Boundaries

1. **Zero Key Storage in Git**:
   - Google Maps API keys MUST NEVER be committed to the repository.
   - Use compile-time environment variables (`--dart-define=GOOGLE_MAPS_API_KEY=...`) or native secret injections (`strings.xml` / `local.properties` ignored by `.gitignore`).
2. **Quota & Cost Controls**:
   - OSRM should remain the default or fallback router for non-revenue or offline scenarios to minimize Google Directions API query costs.
   - Tile caching and dynamic vector rendering should be restricted by API key HTTP referrer and Android/iOS SHA-1 fingerprint restrictions.
3. **No Migration 017 or Database Changes Needed**:
   - Map coordinates in PostgreSQL are stored as standard `NUMERIC` or `DOUBLE PRECISION` columns (`pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`). No schema changes or migrations are needed for Google Maps integration.
