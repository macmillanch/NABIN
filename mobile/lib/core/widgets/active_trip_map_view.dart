import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../config/map_config.dart';
import '../models/geo_coord.dart';

class ActiveTripMapView extends StatefulWidget {
  /// Pickup location as either [GeoCoord] or `latlong2.LatLng`.
  final dynamic pickup;

  /// Dropoff location as either [GeoCoord] or `latlong2.LatLng`.
  final dynamic drop;

  final String? pickupLabel;
  final String? dropLabel;

  /// Driver location as either [GeoCoord] or `latlong2.LatLng`.
  final dynamic driverLocation;

  final double? driverHeading;
  final DateTime? driverLocationUpdatedAt;

  /// Calculated road route points as `List<GeoCoord>` or `List<LatLng>`.
  final List<dynamic>? roadRoutePoints;

  final bool isSocketConnected;
  final bool isRoutingLoading;
  final String? routingError;

  const ActiveTripMapView({
    super.key,
    this.pickup,
    this.drop,
    this.pickupLabel,
    this.dropLabel,
    this.driverLocation,
    this.driverHeading,
    this.driverLocationUpdatedAt,
    this.roadRoutePoints,
    this.isSocketConnected = true,
    this.isRoutingLoading = false,
    this.routingError,
  });

  @override
  State<ActiveTripMapView> createState() => _ActiveTripMapViewState();
}

class _ActiveTripMapViewState extends State<ActiveTripMapView> {
  final MapController _mapController = MapController();

  LatLng? _toLatLng(dynamic coord) {
    if (coord == null) return null;
    if (coord is LatLng) return coord;
    if (coord is GeoCoord) return coord.toLatLng();
    if (coord is Map<String, dynamic>) return GeoCoord.fromMap(coord).toLatLng();
    return null;
  }

  List<LatLng>? get _resolvedRoutePoints {
    if (widget.roadRoutePoints == null) return null;
    final List<LatLng> list = [];
    for (final pt in widget.roadRoutePoints!) {
      final resolved = _toLatLng(pt);
      if (resolved != null) list.add(resolved);
    }
    return list.isNotEmpty ? list : null;
  }

  LatLng? get _resolvedPickup => _toLatLng(widget.pickup);
  LatLng? get _resolvedDrop => _toLatLng(widget.drop);
  LatLng? get _resolvedDriverLocation => _toLatLng(widget.driverLocation);

  LatLng get _viewportCenter {
    final driver = _resolvedDriverLocation;
    final pickup = _resolvedPickup;
    final drop = _resolvedDrop;

    if (driver != null && pickup != null) {
      return LatLng(
        (driver.latitude + pickup.latitude) / 2,
        (driver.longitude + pickup.longitude) / 2,
      );
    }
    if (pickup != null && drop != null) {
      return LatLng(
        (pickup.latitude + drop.latitude) / 2,
        (pickup.longitude + drop.longitude) / 2,
      );
    }
    return driver ?? pickup ?? drop ?? MapConfig.defaultCenter.toLatLng();
  }

  @override
  void didUpdateWidget(ActiveTripMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldDriver = _toLatLng(oldWidget.driverLocation);
    final currentDriver = _resolvedDriverLocation;
    if (currentDriver != null && oldDriver != currentDriver) {
      _mapController.move(_viewportCenter, 14.5);
    }
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isStale = widget.driverLocationUpdatedAt != null &&
        DateTime.now().difference(widget.driverLocationUpdatedAt!).inSeconds > 30;
    final hasDriver = _resolvedDriverLocation != null;

    return SizedBox(
      height: 280,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(
          children: [
            // Map Rendering Engine (OpenStreetMap by default, with Google Maps pluggability)
            _buildMapRenderer(_viewportCenter, isStale),

            // Live Telemetry Status Banner (Top right HUD)
            Positioned(
              top: 12,
              left: 12,
              right: 12,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(
                    child: _buildTelemetryBadge(
                      hasDriver: hasDriver,
                      isStale: isStale,
                      isConnected: widget.isSocketConnected,
                    ),
                  ),
                  if (widget.routingError != null &&
                      _resolvedRoutePoints == null) ...[
                    const SizedBox(width: 8),
                    Flexible(
                      child: Container(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: Colors.black87,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.route_outlined,
                                size: 14, color: Colors.amber),
                            SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                'Road route unavailable',
                                style: TextStyle(color: Colors.white, fontSize: 11),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMapRenderer(LatLng center, bool isStale) {
    switch (MapConfig.activeMapProvider) {
      case MapProviderType.googleMaps:
        return _buildGoogleMapsPlaceholder(center);
      case MapProviderType.flutterMapOsm:
      default:
        return _buildFlutterMapOsm(center, isStale);
    }
  }

  Widget _buildFlutterMapOsm(LatLng center, bool isStale) {
    final routePoints = _resolvedRoutePoints;
    final pickup = _resolvedPickup;
    final drop = _resolvedDrop;
    final driver = _resolvedDriverLocation;

    return FlutterMap(
      mapController: _mapController,
      options: MapOptions(
        initialCenter: center,
        initialZoom: 14.2,
        minZoom: 4.0,
        maxZoom: 18.5,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.drag |
              InteractiveFlag.pinchZoom |
              InteractiveFlag.doubleTapZoom,
        ),
      ),
      children: [
        // Centralized Tile Provider Configuration
        TileLayer(
          urlTemplate: MapConfig.tileUrlTemplate,
          subdomains: MapConfig.tileSubdomains,
          fallbackUrl: MapConfig.tileFallbackUrl,
          userAgentPackageName: MapConfig.userAgentPackageName,
          maxZoom: 20,
        ),

        // Verified Road Route Polyline (Zero fake straight lines)
        if (routePoints != null && routePoints.isNotEmpty)
          PolylineLayer(
            polylines: [
              Polyline(
                points: routePoints,
                strokeWidth: 5.5,
                color: const Color(0xFF1A3BA2).withValues(alpha: 0.85),
              ),
            ],
          ),

        // Markers Layer
        MarkerLayer(
          markers: [
            // 1. Pickup Marker
            if (pickup != null)
              Marker(
                point: pickup,
                width: 140,
                height: 52,
                child: _buildLocationPin(
                  label: 'Pickup',
                  color: const Color(0xFF00A859),
                  icon: Icons.my_location_rounded,
                ),
              ),

            // 2. Dropoff Marker
            if (drop != null)
              Marker(
                point: drop,
                width: 140,
                height: 52,
                child: _buildLocationPin(
                  label: 'Drop-off',
                  color: const Color(0xFFE53935),
                  icon: Icons.location_on_rounded,
                ),
              ),

            // 3. Live Driver Marker (Rotated according to bearing)
            if (driver != null)
              Marker(
                point: driver,
                width: 52,
                height: 52,
                child: _buildDriverMarker(
                  heading: widget.driverHeading ?? 0.0,
                  isStale: isStale,
                ),
              ),
          ],
        ),
      ],
    );
  }

  /// Structural placeholder slot for future Google Maps Native SDK adapter.
  Widget _buildGoogleMapsPlaceholder(LatLng center) {
    return Container(
      color: const Color(0xFFE8EAED),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.map_rounded, size: 36, color: Color(0xFF1A73E8)),
            const SizedBox(height: 8),
            const Text(
              'Google Maps Adapter Slot',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 4),
            Text(
              MapConfig.isGoogleMapsConfigured
                  ? 'Ready to mount google_maps_flutter'
                  : 'Configure MapConfig.googleMapsApiKey to enable',
              style: const TextStyle(fontSize: 11, color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDriverMarker({
    required double heading,
    required bool isStale,
  }) {
    return Transform.rotate(
      angle: heading * (3.141592653589793 / 180),
      child: Container(
        decoration: BoxDecoration(
          color: isStale ? const Color(0xFF757575) : const Color(0xFF1A3BA2),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.25),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: const Center(
          child: Icon(
            Icons.navigation_rounded,
            color: Colors.white,
            size: 24,
          ),
        ),
      ),
    );
  }

  Widget _buildTelemetryBadge({
    required bool hasDriver,
    required bool isStale,
    required bool isConnected,
  }) {
    if (!isConnected) {
      return _badge(
        color: const Color(0xFFFFA000),
        icon: Icons.sync_problem_rounded,
        label: 'Reconnecting live GPS…',
      );
    }
    if (!hasDriver) {
      return _badge(
        color: const Color(0xFF757575),
        icon: Icons.sensors_outlined,
        label: 'Waiting for driver GPS…',
      );
    }
    if (isStale) {
      return _badge(
        color: const Color(0xFFE65100),
        icon: Icons.history_rounded,
        label: 'Driver signal delayed',
      );
    }
    return _badge(
      color: const Color(0xFF00A859),
      icon: Icons.navigation_rounded,
      label: 'Live Driver GPS',
    );
  }

  Widget _badge({
    required Color color,
    required IconData icon,
    required String label,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(color: Colors.black12, blurRadius: 6, offset: Offset(0, 2)),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w700,
                fontSize: 11,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLocationPin({
    required String label,
    required Color color,
    required IconData icon,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10),
            boxShadow: const [
              BoxShadow(
                  color: Colors.black26, blurRadius: 4, offset: Offset(0, 2)),
            ],
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
        ),
        const SizedBox(height: 2),
        Icon(icon, color: color, size: 24),
      ],
    );
  }
}
